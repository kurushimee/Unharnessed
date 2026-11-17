//! A signed-in subscription's current token, for the window's own requests
//! to the provider about the account (its usage limits and reset credits).
//!
//! `_unharnessed/auth/fresh` `{ provider }` answers `{ credential }`: the
//! stored OAuth login of `provider` (`{ access, expires, accountId? }`,
//! `accountId` the `ChatGPT` account of a Codex login or the project of an
//! Antigravity one), refreshed first when it has expired, the way a model
//! request refreshes it (under the storage lock, saved to auth.json); `null`
//! when the provider has no OAuth login or its refresh failed.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};

use super::{jsonrpc, producer};
use uh_core::auth::{AuthCredential, AuthStorage};

pub(super) const AUTH_FRESH: &str = "_unharnessed/auth/fresh";

pub(super) async fn handle_auth_fresh(
    id: Value,
    params: Value,
    agent_dir: Arc<PathBuf>,
    tx: producer::FrameSink,
) {
    let Some(provider) = params
        .get("provider")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|provider| !provider.is_empty())
        .map(str::to_string)
    else {
        let _ = tx.send(jsonrpc::error_response(
            &id,
            jsonrpc::INVALID_PARAMS,
            "Invalid params",
            Some(&json!({ "details": "`provider` is missing." })),
        ));
        return;
    };
    // The storage reads auth.json, and a refresh is a blocking round trip.
    let credential = tokio::task::spawn_blocking(move || {
        let mut auth = AuthStorage::create(agent_dir.as_ref());
        let found = auth.get_api_key_with_source_token(&provider, false);
        if found.credential_type != Some("oauth") || found.api_key.is_none() {
            return Value::Null;
        }
        match auth.get_all().credential(&provider) {
            Some(AuthCredential::Oauth {
                access,
                expires,
                account_id,
                ..
            }) => json!({ "access": access, "expires": expires, "accountId": account_id }),
            _ => Value::Null,
        }
    })
    .await
    .unwrap_or(Value::Null);
    let _ = tx.send(jsonrpc::response(&id, &json!({ "credential": credential })));
}
