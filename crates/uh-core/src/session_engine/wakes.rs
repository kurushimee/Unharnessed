//! Deferred wake-ups of an idle in-process session (`-p` and ACP): a
//! detached `bash()` completion, a quota park's reset, the goal's no-progress
//! backoff, and the goal continuation owed behind a running `bash()`. The daemon worker owned them before
//! (`bash_notices`, the quota-resume and goal-backoff cron jobs); the
//! in-process hosts now drive them through [`SessionEngine::next_wake`].
//!
//! The kernel sends `bash.completed` when a background `bash()` outlives
//! the cell that started it and nobody read its result (`bash.py`). The
//! notice waits here until the host reaches a settled boundary, and a read
//! that reaches the model first (`bash.consumed`) withdraws it. Unlike the
//! daemon, a notice is never steered into a running turn: the host
//! delivers it once the run settles.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::Notify;
use tokio::time::Instant;

use super::engine::SessionEngine;
use super::goal_driver::GOAL_BACKOFF_WAKE_MARKER_TEXT;
use super::messages::{create_async_bash_completion_message, mark_async_bash_timeout};
use super::provider_park::QUOTA_RESUME_MARKER_TEXT;
use crate::kernel::shared::{host_handler, HostRequestHandlers};

/// How long a finished command's notice may wait for the commands still
/// running beside it: the notices then go together, in one turn.
const NOTICE_BATCH_MS: u64 = 2 * 60 * 1000;

/// What wakes an idle session.
#[derive(Debug, Clone)]
pub enum Wake {
    /// Detached `bash()` commands finished: the turn runs on these injected
    /// `[bash-done ...]` rows (`AgentSession::prompt_injected_messages`).
    BashDone(Vec<uh_types::session::CustomMessage>),
    /// A timed wake (quota reset, goal backoff): the turn runs on this
    /// marker prompt.
    Marker(&'static str),
    /// The goal's wait on a command is over: the turn runs on the continuation
    /// the host takes at admission
    /// ([`SessionEngine::take_owed_goal_continuation`]).
    GoalContinuation,
}

impl Wake {
    /// What woke the session: `bash`, `quota` or `goal`.
    #[must_use]
    pub fn kind(&self) -> &'static str {
        match self {
            Wake::BashDone(_) => "bash",
            Wake::Marker(text) if *text == QUOTA_RESUME_MARKER_TEXT => "quota",
            Wake::Marker(_) | Wake::GoalContinuation => "goal",
        }
    }
}

/// A provider usage limit a turn stopped on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QuotaLimit {
    /// When the provider said it resets (epoch ms), when it said.
    pub reset_at_ms: Option<u64>,
}

/// The session's pending wakes; the `bash.*` host handlers and the retry
/// chain's quota park feed it, the host drains it.
#[derive(Default)]
pub struct SessionWakes {
    state: Mutex<WakeState>,
    changed: Notify,
}

#[derive(Default)]
struct WakeState {
    /// Wakes a host took but could not run yet (ACP: a prompt turn held
    /// the session); they come first.
    requeued: std::collections::VecDeque<Wake>,
    /// Undelivered completions, oldest first, with the pid and command
    /// `bash.consumed` matches on (pids are reused across handles).
    notices: Vec<(u32, String, uh_types::session::CustomMessage)>,
    /// The quota park's resume instant (epoch ms).
    quota_resume_at_ms: Option<u64>,
    /// Parks of the current quota episode; a turn that succeeds ends it.
    quota_parks_used: u32,
    /// The usage limit the last turn stopped on; `None` when it did not.
    quota_limit: Option<QuotaLimit>,
    /// The goal backoff deadline last seen open; due once it passes.
    goal_wake_at_ms: Option<u64>,
}

impl SessionWakes {
    /// Wake a waiting [`SessionEngine::next_wake`]: something it waits on
    /// may have changed (a stored permit covers a waiter that has not
    /// started waiting yet).
    pub fn poke(&self) {
        self.changed.notify_one();
    }

    /// Wait until [`SessionWakes::poke`] signals a change.
    pub async fn changed(&self) {
        self.changed.notified().await;
    }

    /// Hand back a wake the host took but cannot run now: the next
    /// [`SessionEngine::take_due_wake`] returns it first. An owed continuation
    /// needs no keeping: it stays owed until a boundary delivers it, and is
    /// judged due again.
    pub fn requeue(&self, wake: Wake) {
        if !matches!(wake, Wake::GoalContinuation) {
            self.state().requeued.push_front(wake);
        }
    }

    fn state(&self) -> MutexGuard<'_, WakeState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The `bash.completed`/`bash.consumed` kernel host handlers, with the
    /// TS validation: a positive integer pid, a non-empty command, and an
    /// integer exit code (plus, for a command its timeout stopped, a
    /// positive `timeoutSeconds`).
    pub(crate) fn register_host_handlers(wakes: &Arc<Self>, handlers: &mut HostRequestHandlers) {
        let completed = Arc::clone(wakes);
        handlers.register(
            "bash.completed",
            host_handler(move |payload| {
                let wakes = Arc::clone(&completed);
                async move {
                    let (pid, command) = bash_notice_identity(&payload.data)?;
                    let exit_code = payload
                        .data
                        .get("exitCode")
                        .and_then(Value::as_i64)
                        .ok_or_else(|| {
                            anyhow::anyhow!("bash.completed exitCode must be an integer")
                        })?;
                    // Present only when the kernel stopped the command at its timeout.
                    let timeout_seconds = match payload.data.get("timeoutSeconds") {
                        None | Some(Value::Null) => None,
                        Some(value) => {
                            Some(value.as_f64().filter(|seconds| *seconds > 0.0).ok_or_else(
                                || {
                                    anyhow::anyhow!(
                                        "bash.completed timeoutSeconds must be a positive number"
                                    )
                                },
                            )?)
                        }
                    };
                    let mut message =
                        create_async_bash_completion_message(pid, &command, exit_code, now_ms());
                    if let Some(seconds) = timeout_seconds {
                        mark_async_bash_timeout(&mut message, seconds);
                    }
                    wakes.state().notices.push((pid, command, message));
                    wakes.poke();
                    Ok(serde_json::json!({}))
                }
            }),
        );
        let consumed = Arc::clone(wakes);
        handlers.register(
            "bash.consumed",
            host_handler(move |payload| {
                let wakes = Arc::clone(&consumed);
                async move {
                    let (pid, command) = bash_notice_identity(&payload.data)?;
                    wakes
                        .state()
                        .notices
                        .retain(|(notice_pid, notice_command, _)| {
                            *notice_pid != pid || *notice_command != command
                        });
                    Ok(serde_json::json!({}))
                }
            }),
        );
    }

    /// Park the session until `resume_at_ms`: the quota resume marker
    /// becomes due then.
    pub(crate) fn park_quota(&self, resume_at_ms: u64) {
        {
            let mut state = self.state();
            state.quota_resume_at_ms = Some(resume_at_ms);
            state.quota_parks_used += 1;
        }
        self.poke();
    }

    /// When the quota park wakes the session (epoch ms), while it is parked.
    #[must_use]
    pub fn quota_resume_at(&self) -> Option<u64> {
        self.state().quota_resume_at_ms
    }

    /// Wake the session at `resume_at_ms` with the quota resume marker, or
    /// end the park (`None`): the user's own choice for a limited session.
    /// Unlike a retry-chain park, it spends none of the episode's parks.
    pub fn set_quota_resume(&self, resume_at_ms: Option<u64>) {
        self.state().quota_resume_at_ms = resume_at_ms;
        self.poke();
    }

    /// The usage limit the last turn stopped on; `None` when it did not.
    #[must_use]
    pub fn quota_limit(&self) -> Option<QuotaLimit> {
        self.state().quota_limit
    }

    /// Record the limit a failed turn hit (`None`: none, a new turn began).
    pub fn set_quota_limit(&self, limit: Option<QuotaLimit>) {
        self.state().quota_limit = limit;
    }

    pub(crate) fn quota_parks_used(&self) -> u32 {
        self.state().quota_parks_used
    }

    /// A turn succeeded: the quota episode (and its park budget) ends.
    pub(crate) fn end_quota_episode(&self) {
        self.state().quota_parks_used = 0;
    }

    /// Drop the queued completion notices (the work they report is over).
    pub(crate) fn drop_notices(&self) {
        self.state().notices.clear();
    }
}

fn bash_notice_identity(data: &Value) -> anyhow::Result<(u32, String)> {
    let pid = data
        .get("pid")
        .and_then(Value::as_u64)
        .filter(|pid| *pid > 0)
        .and_then(|pid| u32::try_from(pid).ok())
        .ok_or_else(|| anyhow::anyhow!("bash.completed pid must be a positive integer"))?;
    let command = data
        .get("command")
        .and_then(Value::as_str)
        .filter(|command| !command.is_empty())
        .ok_or_else(|| anyhow::anyhow!("bash.completed command must be a non-empty string"))?
        .to_string();
    Ok((pid, command))
}

fn now_ms() -> u64 {
    crate::autonomous::now_millis()
}

impl SessionEngine {
    /// The session's pending wakes.
    #[must_use]
    pub fn wakes(&self) -> &Arc<SessionWakes> {
        &self.wakes
    }

    /// The cleanup after the goal completed (since the last call): the
    /// commands it left running stop without a notice and the queued notices
    /// drop, so nothing wakes a session whose work is done. Returns whether
    /// the goal had completed.
    pub async fn stop_after_completed_goal(&self) -> bool {
        if !self.goal_driver.lock().await.take_completed() {
            return false;
        }
        // No kernel running: no command is left either.
        if let Err(error) = self.bash_activity("kill_all", None, 50).await {
            tracing::debug!("no commands to stop after the goal completed: {error:#}");
        }
        self.wakes.drop_notices();
        true
    }

    /// Whether a `bash()` command of this session still runs, as the kernel
    /// lists them (the goal's wait reads the same list). A failed list or a
    /// dead kernel counts as none.
    async fn any_command_running(&self) -> bool {
        let Ok(listed) = self.bash_activity("list", None, 50).await else {
            return false;
        };
        listed["activities"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|row| row["status"] == "running")
    }

    /// Whether a `bash()` command of this session still runs in the background.
    fn background_work(&self) -> bool {
        self.provisioner
            .manager()
            .is_some_and(|manager| manager.has_background_work())
    }

    /// The next wake due now, if any: a requeued wake first, then the queued
    /// `bash()` completions, a quota resume, the goal backoff (dropped when
    /// the goal is no longer active), and the continuation owed behind a
    /// command (after the completions: they say what ended). Completions go
    /// together once no command runs any more, or once the oldest has waited
    /// [`NOTICE_BATCH_MS`]: a batch of commands wakes the model once, not
    /// once per command. A blocked goal waits for the user: nothing wakes the
    /// session, and the completions stay queued until the goal resumes.
    pub async fn take_due_wake(&self) -> Option<Wake> {
        if self.goal_driver.lock().await.state().status == uh_types::goal::GoalStatus::Blocked {
            return None;
        }
        let owed = self.goal_driver.lock().await.owes_continuation();
        let notices_queued = !self.wakes.state().notices.is_empty();
        // One view of the running commands for the notices and the owed
        // continuation (the kernel's list): the notices then always come
        // before the continuation that the same command's end released.
        let command_running = (owed || notices_queued) && self.any_command_running().await;
        let (goal_window, goal_active, owed_due) = {
            let driver = self.goal_driver.lock().await;
            (
                driver.backoff_wake_at(),
                driver.owns_continuation_wakeup(),
                driver.owed_continuation_due(command_running),
            )
        };
        let now = now_ms();
        let mut state = self.wakes.state();
        if let Some(wake) = state.requeued.pop_front() {
            return Some(wake);
        }
        match goal_window {
            Some(at) => state.goal_wake_at_ms = Some(at),
            // The window closed early (a turn made progress): no wake.
            None if state.goal_wake_at_ms.is_some_and(|at| at > now) => {
                state.goal_wake_at_ms = None;
            }
            None => {}
        }
        if state.notices.first().is_some_and(|(_, _, oldest)| {
            !command_running || now >= oldest.timestamp + NOTICE_BATCH_MS
        }) {
            let notices = state.notices.drain(..).map(|(_, _, notice)| notice);
            return Some(Wake::BashDone(notices.collect()));
        }
        if state.quota_resume_at_ms.is_some_and(|at| at <= now) {
            state.quota_resume_at_ms = None;
            return Some(Wake::Marker(QUOTA_RESUME_MARKER_TEXT));
        }
        if state.goal_wake_at_ms.is_some_and(|at| at <= now) {
            state.goal_wake_at_ms = None;
            if goal_active {
                return Some(Wake::Marker(GOAL_BACKOFF_WAKE_MARKER_TEXT));
            }
        }
        owed_due.then_some(Wake::GoalContinuation)
    }

    /// Wait for the next wake.
    ///
    /// With a `limit` (`-p`), the wait returns `None` once the limit passes,
    /// and at once when nothing can wake the session any more: no queued
    /// notice, no live background `bash()`, no quota park, no open goal
    /// backoff. A goal waiting on a command has its own window and outlasts
    /// the limit: it would otherwise die with the command it waits for.
    /// Without a limit (ACP) it never gives up and sleeps until something
    /// changes.
    pub async fn next_wake(&self, limit: Option<Duration>) -> Option<Wake> {
        let limit_at = limit.map(|limit| Instant::now() + limit);
        loop {
            if let Some(wake) = self.take_due_wake().await {
                return Some(wake);
            }
            let owed_wake_at = self.goal_driver.lock().await.owed_continuation_wake_at();
            let give_up_at = limit_at.filter(|_| owed_wake_at.is_none());
            let deadline_ms = {
                let state = self.wakes.state();
                [
                    state.quota_resume_at_ms,
                    state.goal_wake_at_ms,
                    owed_wake_at,
                    state
                        .notices
                        .first()
                        .map(|(_, _, oldest)| oldest.timestamp + NOTICE_BATCH_MS),
                ]
                .into_iter()
                .flatten()
                .min()
            };
            let background = self.background_work();
            if give_up_at.is_some() && deadline_ms.is_none() && !background {
                return None;
            }
            let deadline = deadline_ms
                .map(|at| Instant::now() + Duration::from_millis(at.saturating_sub(now_ms())));
            let sleep_until = match (give_up_at, deadline) {
                (Some(give_up), Some(deadline)) => Some(give_up.min(deadline)),
                (give_up, deadline) => give_up.or(deadline),
            };
            match sleep_until {
                Some(at) => {
                    tokio::select! {
                        () = self.wakes.changed.notified() => {}
                        () = tokio::time::sleep_until(at) => {}
                    }
                }
                None => self.wakes.changed.notified().await,
            }
            if give_up_at.is_some_and(|at| Instant::now() >= at) {
                return self.take_due_wake().await;
            }
        }
    }
}
