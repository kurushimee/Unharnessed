//! The usage limit a session stopped on, and when it resumes.
//!
//! `_unharnessed/session/quota` `{ sessionId, resumeAt? }` answers
//! `{ limited, resetAt, resumeAt }`: whether the session's last failed turn
//! stopped on a provider usage limit, when the provider said that limit resets (epoch
//! ms, `null` when it did not say), and when the session wakes to go on
//! (epoch ms, `null` when it does not). With `resumeAt` (epoch ms, or `null`)
//! it first changes that wake: the session wakes then with the quota resume
//! marker, as after its own park, or no longer wakes. A change is refused
//! while a turn runs (`-32603`) or for a `resumeAt` that is not a time
//! (`-32602`).

use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::Mutex;

use super::types::session_id_params;
use super::{internal_error, jsonrpc, producer, AcpModeState, ConnectionState};

pub(super) const QUOTA: &str = "_unharnessed/session/quota";

pub(super) async fn handle_quota(
    id: Value,
    params: Value,
    state: Arc<Mutex<ConnectionState>>,
    mode: AcpModeState,
    tx: producer::FrameSink,
) {
    let session_id = session_id_params(&params);
    let change = match params.get("resumeAt") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(value) => {
            let Some(at) = value.as_u64() else {
                let _ = tx.send(jsonrpc::error_response(
                    &id,
                    jsonrpc::INVALID_PARAMS,
                    "Invalid params",
                    Some(&json!({ "details": "resumeAt must be epoch milliseconds or null" })),
                ));
                return;
            };
            Some(Some(at))
        }
    };
    // Held while the wake changes: no prompt or wake turn starts meanwhile.
    let state = state.lock().await;
    let Some(entry) = state
        .session
        .as_ref()
        .filter(|entry| entry.session.id == session_id)
    else {
        let _ = tx.send(internal_error(
            &id,
            &format!("Unknown ACP session: {session_id}"),
        ));
        return;
    };
    let wakes = mode.engine.wakes();
    if let Some(resume_at) = change {
        if state.session_close_in_flight || entry.prompt_task.is_some() {
            let _ = tx.send(internal_error(&id, "The agent is working."));
            return;
        }
        wakes.set_quota_resume(resume_at);
    }
    let limit = wakes.quota_limit();
    let _ = tx.send(jsonrpc::response(
        &id,
        &json!({
            "limited": limit.is_some(),
            "resetAt": limit.and_then(|limit| limit.reset_at_ms),
            "resumeAt": wakes.quota_resume_at(),
        }),
    ));
}
