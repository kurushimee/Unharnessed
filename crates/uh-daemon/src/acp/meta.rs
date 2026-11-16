//! Namespaced `_meta` payloads for unharnessed capabilities that ACP has no
//! native concept for (cwd reporting, quiescence observation, correlation).
//!
//! ACP reserves `_meta` on capability objects, notifications, and content
//! blocks so agents can carry non-standard data. Vanilla ACP clients ignore
//! these keys; an unharnessed-aware client reads them. Non-standard fields
//! never appear at an ACP object root.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The namespace key of every unharnessed `_meta` payload.
pub const UNHARNESSED_META_NAMESPACE: &str = "unharnessed";

/// A client-requested cwd that differs from the agent's actual startup cwd.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UnharnessedCwdMeta {
    pub requested: String,
    pub actual: String,
}

/// Observed autonomous-continuation count at a completion point.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnharnessedQuiescenceMeta {
    pub remaining_autonomous_continuations: u64,
}

/// Producer-side ordering of an update inside its prompt turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UnharnessedEventPhase {
    /// Ordinary streamed work.
    #[serde(rename = "event")]
    Event,
    /// The correlated boundary in front of a prompt response.
    #[serde(rename = "responseBoundary")]
    ResponseBoundary,
    /// The final settled state after the response boundary.
    #[serde(rename = "terminalQuiescence")]
    TerminalQuiescence,
}

/// The outcome carried by a response boundary and terminal envelope. ACP
/// transport stop reasons (including `end_turn`) are never a causal
/// completion signal, so this is deliberately only `result` and `error`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UnharnessedOutcome {
    #[serde(rename = "result")]
    Result,
    #[serde(rename = "error")]
    Error,
}

/// The unharnessed payload under the `_meta` namespace key.
///
/// `prompt_turn_id` is allocated when ACP accepts a prompt, never inferred
/// from whichever prompt happens to be running when an update is delivered;
/// `0` means a session-scoped event with no prompt origin. `event_sequence`
/// is connection-wide and strictly increases for every published update.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnharnessedSessionMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_turn_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_sequence: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<UnharnessedEventPhase>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<UnharnessedOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_quiescence_expected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<UnharnessedCwdMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quiescence: Option<UnharnessedQuiescenceMeta>,
    /// Rich kernel output reported by the ipython tool (attachments the cell
    /// loaded into context, the number of diffs it displayed, the exception
    /// it raised).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ipython: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal: Option<UnharnessedGoalMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compaction: Option<UnharnessedCompactionMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub autonomous: Option<UnharnessedAutonomousMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_start: Option<UnharnessedTurnStartMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<UnharnessedCommandMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<UnharnessedThinkingMeta>,
    /// The provider cut the agent's response at the output limit: the agent
    /// goes on from where it stopped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_limit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_end: Option<UnharnessedTurnEndMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<UnharnessedUsageMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved: Option<UnharnessedSavedMeta>,
}

/// The saved conversation an admitted session writes to, as `session/list`
/// names it: its id (what `session/load` takes) and its file (what
/// `--resume` takes; absent without persistence). A new session's file is
/// written at its first prompt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnharnessedSavedMeta {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// What the session has used, for the panel's context gauge: published
/// when the session opens, after each message the loop settles, around a
/// compaction and after a picker change, whenever it changed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnharnessedUsageMeta {
    /// The context's tokens: the latest reply's usage plus an estimate of
    /// the messages after it. Absent until a reply measures it (and again
    /// right after a compaction).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<u64>,
    /// The model's context window; 0 when unknown.
    pub window: u64,
    /// The context's tokens past which a compaction runs on its own;
    /// absent when automatic compaction is off.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compact_at: Option<u64>,
    /// What the conversation has cost so far, in dollars: the replies and
    /// the compaction summaries, at the catalog's prices.
    pub cost: f64,
    /// The provider reports what it billed (`OpenRouter`), so `cost` is
    /// not an estimate.
    pub billed: bool,
    /// Prompt tokens each reply could reuse from the provider's cache (the
    /// request before it), and those it did.
    pub cache_reusable: u64,
    pub cache_reused: u64,
    /// Dollars the cache reads saved, at each reply's own prices.
    pub cache_saved: f64,
    /// A compaction runs.
    pub compacting: bool,
}

/// How a turn of a loaded conversation ended (`session/load` replays it;
/// a live turn ends with its prompt's answer or its response boundary).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UnharnessedTurnEndMeta {
    /// `done`, `cancelled` or `failed`.
    pub state: String,
    /// Why it failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// How long it worked, ms: from its first entry to its last, as the
    /// session file dated them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ms: Option<u64>,
}

/// A reasoning block of the streaming assistant message opened or closed.
/// Its text, when the provider sends any, comes as `agent_thought_chunk`s
/// with the same `messageId`, between the two.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnharnessedThinkingMeta {
    /// `start` or `end`.
    pub state: String,
    pub message_id: String,
}

/// What started a prompt turn, published first in it: the client's
/// `session/prompt`, or a wake the agent runs on its own.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnharnessedTurnStartMeta {
    /// `prompt`, `wake`, or `steer`: a message steered into the running
    /// turn (`_unharnessed/session/steer`) joined it here.
    pub origin: String,
    /// What woke the agent: `bash` (a detached `bash()` finished), `quota`
    /// (a provider usage limit reset), `goal` (a goal backoff passed, or its
    /// wait on a command ended).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wake: Option<String>,
    /// Where the conversation stood before the prompt: going back there
    /// (`_unharnessed/session/rewind`) lets it be sent again, changed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rewind_to: Option<String>,
    /// When it began, epoch ms, on a turn `session/load` replays: its first
    /// entry's date in the session file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<u64>,
}

/// What a session command answered (the `/goal` status, `/autonomous
/// status`, a refusal): its result rows, in order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UnharnessedCommandMeta {
    pub name: String,
    pub text: String,
    /// `info`, `warning` or `error`.
    pub severity: String,
}

/// A goal's live state, surfaced after `/goal` commands and driver turns.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnharnessedGoalMeta {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub objective: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_budget: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_used: Option<u64>,
    /// When the goal was set, Unix ms: the panel's timer counts from it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    /// The goal's last change, Unix ms: a paused or finished goal's timer
    /// stands at it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
    /// Why it stands where it does: what a blocked goal shows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_reason: Option<String>,
}

/// One compaction that ran during the session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnharnessedCompactionMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_before: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

/// Autonomous-mode accounting surfaced with a turn's completion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnharnessedAutonomousMeta {
    pub enabled: bool,
    pub continuations_used: u64,
    pub turns_used: u64,
    pub tokens_used: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate_attempt: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate_failure: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_reason: Option<String>,
}

/// The `_meta.autonomous` accounting for a completion update: per-run usage
/// plus the latest gate attempt and failure (TS `autonomousMeta` in
/// acp-mode.ts). Shared by the in-process and daemon-attached settlements.
pub fn autonomous_meta(
    status: &uh_core::autonomous::AgentAutonomousStatus,
) -> UnharnessedAutonomousMeta {
    let gate_attempt = std::iter::once(
        status
            .last_gate_failure
            .as_ref()
            .map_or(0, |failure| failure.attempt),
    )
    .chain(status.gate_attempts.values().copied())
    .max()
    .unwrap_or(0);
    UnharnessedAutonomousMeta {
        enabled: status.enabled,
        continuations_used: status.continuations_used,
        turns_used: status.turns_used,
        tokens_used: status.tokens_used,
        gate_attempt: (gate_attempt > 0).then_some(gate_attempt),
        gate_failure: status
            .last_gate_failure
            .as_ref()
            .map(|failure| failure.exit_text.clone()),
        limit_reason: None,
    }
}

/// Wrap an unharnessed payload in its namespaced `_meta` envelope.
pub fn unharnessed_meta(payload: &UnharnessedSessionMeta) -> Value {
    json!({ UNHARNESSED_META_NAMESPACE: payload })
}

/// What a `model` picker value is, beyond its label: the client shows the
/// context window, the input kinds and the price beside the name.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnharnessedModelMeta {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub context_window: u64,
    /// `text`, `image`.
    pub input: Vec<uh_types::ai::ModelInput>,
    /// Dollars per million tokens.
    pub cost: uh_types::ai::ModelCost,
}

/// The `_meta` of one `model` picker value (`{ unharnessed: { model } }`).
pub fn model_meta(model: &UnharnessedModelMeta) -> Value {
    json!({ UNHARNESSED_META_NAMESPACE: { "model": model } })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meta_wraps_under_the_namespace_key() {
        let wrapped = unharnessed_meta(&UnharnessedSessionMeta {
            prompt_turn_id: Some(1),
            event_sequence: Some(2),
            phase: Some(UnharnessedEventPhase::ResponseBoundary),
            outcome: Some(UnharnessedOutcome::Error),
            ..Default::default()
        });
        assert_eq!(
            wrapped,
            json!({ "unharnessed": {
                "promptTurnId": 1,
                "eventSequence": 2,
                "phase": "responseBoundary",
                "outcome": "error",
            }})
        );
    }

    #[test]
    fn quiescence_serializes_camel_case() {
        let wrapped = unharnessed_meta(&UnharnessedSessionMeta {
            quiescence: Some(UnharnessedQuiescenceMeta {
                remaining_autonomous_continuations: 0,
            }),
            ..Default::default()
        });
        assert_eq!(
            wrapped[UNHARNESSED_META_NAMESPACE]["quiescence"],
            json!({ "remainingAutonomousContinuations": 0 })
        );
    }
}
