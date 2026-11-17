//! Provider retry/failover for a settled failed turn, shared by the
//! in-process hosts (`-p` and ACP). The daemon worker ran this chain before;
//! the hosts now call [`SessionEngine::retry_failed_turn`] where a turn
//! settles with an error.
//!
//! [`run_turn_with_provider_failover`] owns the policy: quick retries,
//! the switch to the same model on another configured provider, the quota
//! park. Each re-issue drops the failed assistant message from the loop
//! context (the session file keeps it) and continues the run. A park is
//! kept in memory: the wake ([`super::wakes`]) prompts the resume marker
//! once the reset passes, while the host is still waiting.

use std::cell::{Cell, RefCell};
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use uh_agent::types::{AgentMessage, AssistantMessage, Message, StopReason, ThinkingLevel};
use uh_types::ai::Model;

use super::auto_retry::AutoRetryEvent;
use super::engine::SessionEngine;
use super::messages::create_provider_retry_outcome_message;
use super::provider_adapter::{map_thinking_level, model_thinking_level, ProviderTarget};
use super::provider_failover::run_turn_with_provider_failover;
use super::provider_park::{
    is_quota_block_failure, provider_park_decision, quota_failure_reset_ms,
    quota_parked_final_error, ParkFuture, ProviderParkDecision, ProviderParkOutcome,
};
use super::wakes::QuotaLimit;
use super::TrailingAssistantFilter;

/// What the host lends the retry chain.
pub struct TurnRetryHost<'a> {
    pub cwd: &'a Path,
    pub agent_dir: &'a Path,
    /// The stream's provider target: a failover switch swaps it.
    pub provider_target: &'a Arc<RwLock<Option<ProviderTarget>>>,
    /// `false` for faux-script sessions: their failures are scripted
    /// fixtures, and another provider would only reroute the queue.
    pub failover: bool,
    /// The longest quota park the host can wait out (`-p`'s wait limit);
    /// `None` parks for any reset the park policy allows (ACP).
    pub max_park: Option<Duration>,
}

/// The settled outcome of a retried turn.
pub struct RetriedTurn {
    /// The turn's final assistant message: an error when the chain gave up.
    pub message: AssistantMessage,
    /// The chain parked the turn until a quota reset: the failed message
    /// left the loop context, and the session's wake resumes the work.
    pub parked: bool,
}

impl SessionEngine {
    /// Re-issue a turn that settled with `failed` under the provider
    /// retry/failover policy (settings `retry`). `cancelled` stops the
    /// backoff waits; `emit` observes the `auto_retry_start`/`_end` events.
    /// A retry episode also leaves one durable `provider_retry_outcome` row.
    ///
    /// # Errors
    ///
    /// Returns an error when a re-issued run cannot start, or when a
    /// failover switch cannot persist its model change.
    ///
    /// # Panics
    ///
    /// Panics if the provider target lock is poisoned.
    pub async fn retry_failed_turn(
        &self,
        host: &TurnRetryHost<'_>,
        failed: AssistantMessage,
        cancelled: &dyn Fn() -> bool,
        emit: &mut dyn FnMut(&AutoRetryEvent),
    ) -> anyhow::Result<RetriedTurn> {
        let Some(primary_target) = host
            .provider_target
            .read()
            .expect("provider target lock")
            .clone()
        else {
            return Ok(RetriedTurn {
                message: failed,
                parked: false,
            });
        };
        let settings = crate::settings::SettingsManager::create(host.cwd, host.agent_dir);
        let policy = settings.get_provider_retry_policy();
        let failover_policy = settings.get_provider_failover_policy();
        let park_policy = settings.get_provider_park_policy();
        let candidates = if host.failover {
            failover_chain(host.agent_dir, &primary_target.model, &settings)
        } else {
            Vec::new()
        };
        let agent = self.session.agent();
        let persistence = self.session.shared_persistence();
        let first_attempt = Cell::new(true);
        let primary: RefCell<Option<(ProviderTarget, ThinkingLevel)>> = RefCell::new(None);
        let last_error: RefCell<Option<String>> = RefCell::new(None);
        let parked = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let emit = RefCell::new(emit);
        let mut park = {
            let wakes = Arc::clone(&self.wakes);
            let parked = Arc::clone(&parked);
            let max_park = host.max_park;
            move |message: AssistantMessage, abort: &str| -> ParkFuture {
                let decision = provider_park_decision(
                    wakes.quota_parks_used(),
                    quota_failure_reset_ms(&message),
                    &park_policy,
                );
                let outcome = match decision {
                    ProviderParkDecision::Park { resume_after_ms }
                        if max_park
                            .is_none_or(|max| u128::from(resume_after_ms) <= max.as_millis()) =>
                    {
                        let resume_at_ms =
                            crate::autonomous::now_millis().saturating_add(resume_after_ms);
                        wakes.park_quota(resume_at_ms);
                        parked.store(true, std::sync::atomic::Ordering::SeqCst);
                        Some(ProviderParkOutcome {
                            status_message: quota_parked_final_error(
                                abort,
                                resume_at_ms,
                                message.error_message.as_deref().unwrap_or("unknown error"),
                            ),
                        })
                    }
                    _ => None,
                };
                Box::pin(async move { outcome })
            }
        };
        // The switch/restore futures borrow the captured state.
        let (primary, primary_target) = (&primary, &primary_target);
        let message = run_turn_with_provider_failover(
            &policy,
            &failover_policy,
            &candidates,
            primary_target.model.context_window,
            None,
            || {
                let first = first_attempt.replace(false);
                let failed = failed.clone();
                async move {
                    if first {
                        return Ok(failed);
                    }
                    resend_with_stored_credentials(host);
                    self.session
                        .drop_trailing_assistant(TrailingAssistantFilter::ErrorOnly)
                        .await;
                    agent.continue_run().await?;
                    agent.wait_for_idle().await;
                    latest_assistant(agent)
                        .await
                        .ok_or_else(|| anyhow::anyhow!("No response produced."))
                }
            },
            |event| {
                (emit.borrow_mut())(&event);
                let outcome = match &event {
                    AutoRetryEvent::Start { error_message, .. } => {
                        *last_error.borrow_mut() = Some(error_message.clone());
                        None
                    }
                    AutoRetryEvent::End {
                        success,
                        attempt,
                        final_error,
                        ..
                    } => {
                        let error = final_error
                            .clone()
                            .or_else(|| last_error.borrow_mut().take())
                            .unwrap_or_else(|| "Unknown error".to_string());
                        Some(create_provider_retry_outcome_message(
                            *success, *attempt, &error,
                        ))
                    }
                };
                let persistence = Arc::clone(&persistence);
                async move {
                    if let Some(row) = outcome {
                        persistence.lock().await.append_custom_message_entry(
                            &row.custom_type,
                            row.content,
                            row.display,
                            row.details,
                        )?;
                    }
                    Ok(())
                }
            },
            |delay| async move {
                let deadline = tokio::time::Instant::now() + delay;
                while tokio::time::Instant::now() < deadline {
                    if cancelled() {
                        return false;
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                !cancelled()
            },
            |next: &Model| {
                let next = next.clone();
                let captured = primary.borrow().is_some();
                async move {
                    let level = agent.state().await.thinking_level;
                    if !captured {
                        *primary.borrow_mut() = Some((primary_target.clone(), level));
                    }
                    let mut registry = model_registry(host.agent_dir);
                    let auth = registry.get_api_key_and_headers(&next, next.headers.as_ref());
                    if !auth.ok {
                        anyhow::bail!(auth.error.unwrap_or_else(|| format!(
                            "no credentials resolved for {}/{}",
                            next.provider, next.id
                        )));
                    }
                    {
                        let mut target =
                            host.provider_target.write().expect("provider target lock");
                        *target = Some(ProviderTarget {
                            api_key: auth.api_key,
                            model: next.clone(),
                            service_tier: primary_target.service_tier,
                            headers: auth.headers,
                        });
                    }
                    let clamped =
                        uh_ai::models::clamp_thinking_level(&next, model_thinking_level(level));
                    self.session
                        .set_model_and_thinking_level(
                            &next,
                            &next.provider,
                            &next.id,
                            map_thinking_level(clamped),
                        )
                        .await
                }
            },
            || {
                let restore = primary.borrow_mut().take();
                async move {
                    let Some((target, level)) = restore else {
                        return Ok(None);
                    };
                    let model = target.model.clone();
                    *host.provider_target.write().expect("provider target lock") = Some(target);
                    self.session
                        .set_model_and_thinking_level(&model, &model.provider, &model.id, level)
                        .await?;
                    Ok(Some(format!("{}/{}", model.provider, model.id)))
                }
            },
            Some(&mut park),
        )
        .await?;
        let parked = parked.load(std::sync::atomic::Ordering::SeqCst);
        // What the client reads of the limit: the parked turn's message
        // leaves the conversation below.
        self.wakes.set_quota_limit(
            (message.stop_reason == StopReason::Error && is_quota_block_failure(&message)).then(
                || QuotaLimit {
                    reset_at_ms: quota_failure_reset_ms(&message)
                        .map(|after| crate::autonomous::now_millis().saturating_add(after)),
                },
            ),
        );
        if message.stop_reason != StopReason::Error {
            self.wakes.end_quota_episode();
        } else if parked {
            // The parked turn is a pause, not a failure: the goal and the
            // terminal result read the turn before it until the resume.
            self.session
                .drop_trailing_assistant(TrailingAssistantFilter::ErrorOnly)
                .await;
        }
        Ok(RetriedTurn { message, parked })
    }
}

/// The TS wire event of one retry-loop event (`auto_retry_start` /
/// `auto_retry_end`), as the json event stream prints it.
#[must_use]
pub fn auto_retry_event_json(event: &AutoRetryEvent) -> serde_json::Value {
    match event {
        AutoRetryEvent::Start {
            attempt,
            max_attempts,
            delay_ms,
            error_message,
            reason,
        } => {
            let mut json = serde_json::json!({
                "type": "auto_retry_start",
                "attempt": attempt,
                "maxAttempts": max_attempts,
                "delayMs": delay_ms,
                "errorMessage": error_message,
            });
            if let super::auto_retry::RetryStartReason::Backup { backup_model } = reason {
                json["reason"] = serde_json::json!("backup");
                json["backupModel"] = serde_json::json!(backup_model);
            }
            json
        }
        AutoRetryEvent::End {
            success,
            attempt,
            final_error,
            restored_model,
        } => {
            let mut json = serde_json::json!({
                "type": "auto_retry_end",
                "success": success,
                "attempt": attempt,
            });
            if let Some(final_error) = final_error {
                json["finalError"] = serde_json::json!(final_error);
            }
            if let Some(restored_model) = restored_model {
                json["restoredModel"] = serde_json::json!(restored_model);
            }
            json
        }
    }
}

/// The failover chain for `current`: the other auth-configured providers
/// serving the same model id, in catalog order, inside the settings
/// `allowedModels` pin.
fn failover_chain(
    agent_dir: &Path,
    current: &Model,
    settings: &crate::settings::SettingsManager,
) -> Vec<Model> {
    let registry = model_registry(agent_dir);
    let available: Vec<Model> = registry.get_available().into_iter().cloned().collect();
    let candidates = crate::models::failover_candidates(current, &available);
    match settings.get_allowed_models() {
        None => candidates,
        Some(patterns) => candidates
            .into_iter()
            .filter(|candidate| {
                crate::models::model_allowed(
                    &format!("{}/{}", candidate.provider, candidate.id),
                    &patterns,
                )
            })
            .collect(),
    }
}

/// Point the run's provider target at the credential stored now, before a
/// retry: a run resolves its key once, and another process sharing the login
/// may have refreshed it since (an OAuth refresh revokes the access token the
/// run holds). The model, tier and target stay.
fn resend_with_stored_credentials(host: &TurnRetryHost<'_>) {
    let Some(current) = host
        .provider_target
        .read()
        .expect("provider target lock")
        .clone()
    else {
        return;
    };
    let auth = model_registry(host.agent_dir)
        .get_api_key_and_headers(&current.model, current.model.headers.as_ref());
    if !auth.ok || auth.api_key.is_none() || auth.api_key == current.api_key {
        return;
    }
    if let Some(target) = host
        .provider_target
        .write()
        .expect("provider target lock")
        .as_mut()
    {
        if target.model.provider == current.model.provider && target.model.id == current.model.id {
            target.api_key = auth.api_key;
            target.headers = auth.headers;
        }
    }
}

fn model_registry(agent_dir: &Path) -> crate::models::ModelRegistry {
    let mut registry = crate::models::ModelRegistry::create(
        crate::auth::AuthStorage::create(agent_dir),
        agent_dir.join("models.json"),
    );
    registry.load_private_authorization_from_cache();
    registry
}

/// The newest assistant message of the loop context.
async fn latest_assistant(agent: &uh_agent::agent::Agent) -> Option<AssistantMessage> {
    agent
        .state()
        .await
        .messages
        .into_iter()
        .rev()
        .find_map(|message| match message {
            AgentMessage::Standard(Message::Assistant(assistant)) => Some(assistant),
            _ => None,
        })
}
