//! Provider login over ACP: the `_unharnessed/providers/*` extension methods
//! the VS Code extension's login screens drive. The flows are the
//! composition root's ([`ProviderAuthCommands`], implemented in uh-cli);
//! this module lists the providers, stores and removes credentials, and
//! relays a running login's panel requests (the sign-in URL, the paste
//! prompts, the Prime team picker) to the client.
//!
//! - `_unharnessed/providers/list` answers `{ providers }`.
//! - `_unharnessed/providers/reload` reads the credentials and the local
//!   servers again, as after a login here, and answers `{ providers }`:
//!   the client sends it after a login or logout in another agent on the
//!   same agent dir (the pickers follow once the models are found again).
//! - `_unharnessed/providers/set_api_key` `{ providerId, apiKey }` and
//!   `_unharnessed/providers/logout` `{ providerId }` answer
//!   `{ providers, outcome, message? }` (outcome `done`, `failed` or
//!   `cancelled`; `message` is the status line, or the error to show).
//! - `_unharnessed/providers/login` `{ providerId }` runs a browser login
//!   (the subscriptions, Prime Inference, and an MCP server's OAuth sign-in
//!   as `mcp:<server>`) and answers the same shape when it
//!   settles. Until then each step reaches the client as a
//!   `_unharnessed/providers/login_update` notification
//!   `{ providerId, update }`. A prompt update carries a `promptId` the
//!   client answers with `_unharnessed/providers/login_answer`; an
//!   `optional` prompt is an alternative to the browser sign-in running
//!   beside it (a pasted redirect URL, a Prime API key)
//!   `{ promptId, answer }`. The `_unharnessed/providers/login_cancel`
//!   notification stops the flow, and so does the client disconnecting.
//!   One login runs at a time.
//! - `_unharnessed/providers/login_open` opens the running login's sign-in
//!   page in the browser of the agent's machine. Nothing opens it unasked;
//!   a client on another machine than the agent opens the URL itself.
//! - The local model servers ([`uh_core::models::local`]):
//!   `_unharnessed/providers/local_scan` answers `{ servers }`, those
//!   running at their usual addresses; `_unharnessed/providers/local_probe`
//!   `{ baseUrl, apiKey? }` answers `{ server }` or `{ error: { kind,
//!   message } }`; `_unharnessed/providers/local_save` (a `SaveServer`) and
//!   `_unharnessed/providers/local_remove` `{ providerId }` write
//!   models.json and answer as `set_api_key`. A local server's row carries
//!   `local: { baseUrl, models }`.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot};

use crate::auth_panel::{
    AuthPanelHandle, AuthPanelRequest, FlowCancel, PastePromptTone, PasteStyle, PrimeTeamOption,
    PrimeTeamPick,
};
use crate::provider_auth::{
    AuthFlow, AuthStatusStyle, AuthType, ProviderAuthCommands, ProviderAuthOutcome, ProviderRow,
};

use uh_core::models::local;

use super::jsonrpc;
use super::producer::FrameSink;

pub(super) const LIST: &str = "_unharnessed/providers/list";
pub(super) const RELOAD: &str = "_unharnessed/providers/reload";
pub(super) const SET_API_KEY: &str = "_unharnessed/providers/set_api_key";
pub(super) const LOGOUT: &str = "_unharnessed/providers/logout";
pub(super) const LOGIN: &str = "_unharnessed/providers/login";
pub(super) const LOGIN_ANSWER: &str = "_unharnessed/providers/login_answer";
pub(super) const LOGIN_OPEN: &str = "_unharnessed/providers/login_open";
pub(super) const LOGIN_CANCEL: &str = "_unharnessed/providers/login_cancel";
const LOGIN_UPDATE: &str = "_unharnessed/providers/login_update";
const LOCAL_SCAN: &str = "_unharnessed/providers/local_scan";
const LOCAL_PROBE: &str = "_unharnessed/providers/local_probe";
const LOCAL_SAVE: &str = "_unharnessed/providers/local_save";
const LOCAL_REMOVE: &str = "_unharnessed/providers/local_remove";

/// The provider surface of one connection: the composition root's flows and
/// the running login, if any.
#[derive(Clone)]
pub(super) struct Providers {
    auth: Arc<dyn ProviderAuthCommands>,
    /// Where models.json is, with the local servers.
    agent_dir: Arc<PathBuf>,
    logins: Arc<Mutex<Logins>>,
    /// Signalled when a login, an API key or a logout changed the stored
    /// credentials: the model pickers follow.
    auth_changes: Arc<tokio::sync::Notify>,
}

#[derive(Default)]
struct Logins {
    running: Option<LoginRun>,
    /// Prompt ids are unique on the connection, so an answer meant for an
    /// earlier login never reaches a later one.
    last_prompt_id: u64,
}

struct LoginRun {
    cancel: FlowCancel,
    prompts: HashMap<u64, PendingPrompt>,
    /// The sign-in page, once the flow has one.
    url: Option<String>,
}

/// A prompt the flow is waiting on, with the reply that unblocks it.
enum PendingPrompt {
    Text {
        reply: oneshot::Sender<Option<String>>,
        allow_empty: bool,
    },
    Team {
        reply: oneshot::Sender<PrimeTeamPick>,
        teams: Vec<PrimeTeamOption>,
    },
}

/// What a credential is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Method {
    Subscription,
    ApiKey,
}

/// How the client logs the row in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Login {
    /// `_unharnessed/providers/login`: the browser flow, which may prompt.
    Browser,
    /// The client asks for the key and calls `set_api_key`.
    ApiKey,
}

/// One provider row as the client shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderEntry {
    id: String,
    name: String,
    method: Method,
    login: Login,
    /// A usable credential of this kind exists.
    connected: bool,
    /// The credential is in auth.json, so `logout` removes it. A key from
    /// the environment or models.json is connected but not removable.
    removable: bool,
    /// Where an outside credential comes from (`env: OPENAI_API_KEY`), or
    /// why the row is not connected (`subscription configured`: the
    /// provider's slot holds the other kind of credential; `expired`).
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
    /// The Anthropic subscription warning, on the row that uses it.
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
    /// A local server's address and models, from models.json.
    #[serde(skip_serializing_if = "Option::is_none")]
    local: Option<LocalEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalEntry {
    base_url: String,
    models: Vec<String>,
    specs: BTreeMap<String, local::ModelSpecs>,
}

impl Providers {
    pub(super) fn new(auth: Arc<dyn ProviderAuthCommands>, agent_dir: PathBuf) -> Self {
        Providers {
            auth,
            agent_dir: Arc::new(agent_dir),
            logins: Arc::new(Mutex::new(Logins::default())),
            auth_changes: Arc::new(tokio::sync::Notify::new()),
        }
    }

    /// Signalled after each login, API key or logout that went through.
    pub(super) fn auth_changes(&self) -> Arc<tokio::sync::Notify> {
        Arc::clone(&self.auth_changes)
    }

    /// Handle one `_unharnessed/providers/*` request. `false`: not one of
    /// ours.
    pub(super) async fn handle_request(
        &self,
        id: &Value,
        method: &str,
        params: &Value,
        tx: &FrameSink,
    ) -> bool {
        let reply = match method {
            LIST => Ok(json!({ "providers": self.entries().await })),
            RELOAD => {
                self.auth_changes.notify_one();
                Ok(json!({ "providers": self.entries().await }))
            }
            SET_API_KEY => self.set_api_key(params).await,
            LOGOUT => self.logout(params).await,
            LOGIN => {
                // The flow outlives this handler: it answers when it settles.
                if let Err(details) = self.start_login(id, params, tx) {
                    let _ = tx.send(invalid_params(id, &details));
                }
                return true;
            }
            LOGIN_ANSWER => self.answer(params).map(|()| json!({})),
            LOGIN_OPEN => self.open_url().map(|()| json!({})),
            LOCAL_SCAN => Ok(json!({ "servers": local::scan().await })),
            LOCAL_PROBE => local_probe(params).await,
            LOCAL_SAVE => self.local_save(params).await,
            LOCAL_REMOVE => self.local_remove(params).await,
            _ => return false,
        };
        let _ = tx.send(match reply {
            Ok(result) => jsonrpc::response(id, &result),
            Err(details) => invalid_params(id, &details),
        });
        true
    }

    /// Stop the running login (`login_cancel`, or the client went away): its
    /// pending prompts resolve as cancelled and the flow writes nothing.
    pub(super) fn cancel_login(&self) {
        if let Some(run) = &self.logins.lock().expect("logins lock").running {
            run.cancel.mark();
        }
    }

    async fn set_api_key(&self, params: &Value) -> Result<Value, String> {
        let provider_id = string_param(params, "providerId")?;
        let row = self
            .row(&provider_id, AuthFlow::ApiKeyPrompt)
            .await
            .ok_or_else(|| format!("no API key login for provider {provider_id}"))?;
        // A pasted key often carries a trailing newline.
        let api_key = params.get("apiKey").and_then(Value::as_str).map(str::trim);
        let outcome = self.auth.login(&row, api_key).await;
        Ok(self.settled(outcome).await)
    }

    async fn logout(&self, params: &Value) -> Result<Value, String> {
        let provider_id = string_param(params, "providerId")?;
        let row = self
            .auth
            .logout_options()
            .await
            .into_iter()
            .find(|row| row.id == provider_id)
            .ok_or_else(|| format!("no stored credential for provider {provider_id}"))?;
        let outcome = self.auth.logout(&row).await;
        Ok(self.settled(outcome).await)
    }

    async fn local_save(&self, params: &Value) -> Result<Value, String> {
        let request: local::SaveServer =
            serde_json::from_value(params.clone()).map_err(|error| error.to_string())?;
        let models_json = self.agent_dir.join("models.json");
        let saved = tokio::task::spawn_blocking(move || {
            let id = local::save_server(&models_json, &request)?;
            let count = request.models.len();
            Ok(format!(
                "{count} model{} of {id} in the model menu",
                if count == 1 { "" } else { "s" }
            ))
        })
        .await
        .map_err(|error| error.to_string())?;
        Ok(self.settled(local_outcome(saved)).await)
    }

    async fn local_remove(&self, params: &Value) -> Result<Value, String> {
        let provider_id = string_param(params, "providerId")?;
        let models_json = self.agent_dir.join("models.json");
        let removed = tokio::task::spawn_blocking(move || {
            local::remove_server(&models_json, &provider_id)?;
            Ok(format!("{provider_id} removed"))
        })
        .await
        .map_err(|error| error.to_string())?;
        Ok(self.settled(local_outcome(removed)).await)
    }

    fn start_login(&self, id: &Value, params: &Value, tx: &FrameSink) -> Result<(), String> {
        let provider_id = string_param(params, "providerId")?;
        let (requests, inbox) = mpsc::unbounded_channel();
        let panel = AuthPanelHandle::new(requests);
        {
            let mut logins = self.logins.lock().expect("logins lock");
            if logins.running.is_some() {
                return Err("a login is already running".to_string());
            }
            logins.running = Some(LoginRun {
                cancel: panel.cancel_signal(),
                prompts: HashMap::new(),
                url: None,
            });
        }
        let providers = self.clone();
        let (id, tx) = (id.clone(), tx.clone());
        tokio::spawn(async move {
            let row = match mcp_login_row(&provider_id) {
                Some(row) => Some(row),
                None => providers.row(&provider_id, AuthFlow::TerminalFlow).await,
            };
            let Some(row) = row else {
                providers.logins.lock().expect("logins lock").running = None;
                let details = format!("no browser login for provider {provider_id}");
                let _ = tx.send(invalid_params(&id, &details));
                return;
            };
            let flow = providers.auth.login_on_panel(&row, panel);
            // The relay ends when the flow drops its panel handles, so every
            // update leaves before the answer.
            let relay = providers.relay(inbox, &provider_id, &tx);
            let (outcome, ()) = tokio::join!(flow, relay);
            providers.logins.lock().expect("logins lock").running = None;
            let result = providers.settled(outcome).await;
            let _ = tx.send(jsonrpc::response(&id, &result));
        });
        Ok(())
    }

    /// Send each panel request to the client; park the prompts' replies
    /// until `login_answer`.
    async fn relay(
        &self,
        mut inbox: mpsc::UnboundedReceiver<AuthPanelRequest>,
        provider_id: &str,
        tx: &FrameSink,
    ) {
        while let Some(request) = inbox.recv().await {
            let update = match request {
                AuthPanelRequest::Progress { message, .. } => {
                    json!({ "kind": "progress", "message": message })
                }
                AuthPanelRequest::Waiting { message } => {
                    json!({ "kind": "waiting", "message": message })
                }
                AuthPanelRequest::AuthUrl { url, instructions } => {
                    if let Some(run) = &mut self.logins.lock().expect("logins lock").running {
                        run.url = Some(url.clone());
                    }
                    json!({ "kind": "url", "url": url, "instructions": instructions })
                }
                AuthPanelRequest::PastePrompt {
                    prompt,
                    tone,
                    style,
                    allow_empty,
                    reply,
                } => {
                    let prompt_id = self.park(PendingPrompt::Text { reply, allow_empty });
                    json!({
                        "kind": "prompt",
                        "promptId": prompt_id,
                        "message": prompt,
                        "secret": style == PasteStyle::Masked,
                        "allowEmpty": allow_empty,
                        // The muted prompts are the TS `showManualInput`
                        // ones: a paste racing the browser sign-in.
                        "optional": tone == PastePromptTone::Muted,
                    })
                }
                AuthPanelRequest::SelectTeam {
                    teams,
                    current,
                    reply,
                } => {
                    let options: Vec<Value> = teams
                        .iter()
                        .map(|team| json!({ "id": team.team_id, "name": team.name, "role": team.role }))
                        .collect();
                    let prompt_id = self.park(PendingPrompt::Team { reply, teams });
                    json!({
                        "kind": "team",
                        "promptId": prompt_id,
                        "teams": options,
                        "current": current,
                    })
                }
                // The settled requests belong to the TUI's session wrapper;
                // here the flow's own result settles the request.
                AuthPanelRequest::ProviderSettled { .. } | AuthPanelRequest::McpSettled { .. } => {
                    continue;
                }
            };
            let params = json!({ "providerId": provider_id, "update": update });
            let _ = tx.send(jsonrpc::notification(LOGIN_UPDATE, &params));
        }
    }

    fn park(&self, prompt: PendingPrompt) -> u64 {
        let mut logins = self.logins.lock().expect("logins lock");
        logins.last_prompt_id += 1;
        let prompt_id = logins.last_prompt_id;
        if let Some(run) = &mut logins.running {
            run.prompts.insert(prompt_id, prompt);
        }
        prompt_id
    }

    /// `login_open`: only the running login's own page, never a URL the
    /// client names.
    fn open_url(&self) -> Result<(), String> {
        let logins = self.logins.lock().expect("logins lock");
        let url = logins
            .running
            .as_ref()
            .and_then(|run| run.url.as_deref())
            .ok_or("no sign-in page to open")?;
        uh_core::platform::browser::open_in_browser(url);
        Ok(())
    }

    /// `login_answer`: `answer` is `{ kind: "text", value }`,
    /// `{ kind: "team", teamId }` (`null` for the personal account) or
    /// `{ kind: "dismiss" }` (a dismissed paste prompt cancels the login; a
    /// dismissed team picker keeps the stored team).
    fn answer(&self, params: &Value) -> Result<(), String> {
        let prompt_id = params
            .get("promptId")
            .and_then(Value::as_u64)
            .ok_or("promptId must be a number")?;
        let answer = params.get("answer").unwrap_or(&Value::Null);
        let kind = answer
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let mut logins = self.logins.lock().expect("logins lock");
        let prompts = &mut logins
            .running
            .as_mut()
            .ok_or("no login is running")?
            .prompts;
        let pending = prompts
            .remove(&prompt_id)
            .ok_or_else(|| format!("no pending prompt {prompt_id}"))?;
        // A reply whose flow already stopped waiting has nobody to tell.
        match (pending, kind) {
            (PendingPrompt::Text { reply, allow_empty }, "text") => {
                let value = answer
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let value = value.trim();
                if value.is_empty() && !allow_empty {
                    prompts.insert(prompt_id, PendingPrompt::Text { reply, allow_empty });
                    return Err("this prompt needs an answer".to_string());
                }
                let _ = reply.send(Some(value.to_string()));
            }
            (PendingPrompt::Text { reply, .. }, "dismiss") => {
                let _ = reply.send(None);
            }
            (PendingPrompt::Team { reply, teams }, "team") => {
                let pick = match answer.get("teamId").and_then(Value::as_str) {
                    None => PrimeTeamPick::PersonalAccount,
                    Some(team_id) => {
                        let Some(team) = teams.iter().find(|team| team.team_id == team_id) else {
                            prompts.insert(prompt_id, PendingPrompt::Team { reply, teams });
                            return Err(format!("no team {team_id} in prompt {prompt_id}"));
                        };
                        PrimeTeamPick::Team(team.clone())
                    }
                };
                let _ = reply.send(pick);
            }
            (PendingPrompt::Team { reply, .. }, "dismiss") => {
                let _ = reply.send(PrimeTeamPick::Cancelled);
            }
            (pending, kind) => {
                prompts.insert(prompt_id, pending);
                return Err(format!(
                    "prompt {prompt_id} does not take a {kind:?} answer"
                ));
            }
        }
        Ok(())
    }

    /// The row the client means: the provider id plus how it logs in
    /// (Anthropic and xAI have both a subscription and an API key row).
    async fn row(&self, provider_id: &str, flow: AuthFlow) -> Option<ProviderRow> {
        self.auth
            .login_options()
            .await
            .into_iter()
            .find(|row| row.id == provider_id && row.flow == flow)
    }

    async fn settled(&self, outcome: ProviderAuthOutcome) -> Value {
        if matches!(outcome, ProviderAuthOutcome::Status(_)) {
            self.auth_changes.notify_one();
        }
        let (outcome, message) = match outcome {
            ProviderAuthOutcome::Status(message) => ("done", Some(message)),
            ProviderAuthOutcome::Error(message) => ("failed", Some(message)),
            ProviderAuthOutcome::Cancelled => ("cancelled", None),
        };
        let mut result = json!({ "providers": self.entries().await, "outcome": outcome });
        if let Some(message) = message {
            result["message"] = json!(message);
        }
        result
    }

    /// The login rows (connected first), with what removes or explains them.
    async fn entries(&self) -> Vec<ProviderEntry> {
        let models_json = self.agent_dir.join("models.json");
        let servers = tokio::task::spawn_blocking(move || local::local_providers(&models_json));
        let (rows, stored, warning, servers) = tokio::join!(
            self.auth.login_options(),
            self.auth.logout_options(),
            self.auth.anthropic_subscription_warning(),
            servers,
        );
        let servers = servers.unwrap_or_default();
        let mut entries: Vec<ProviderEntry> = rows
            .iter()
            .map(|row| {
                let server = servers.iter().find(|server| server.id == row.id);
                // A local server's key is in models.json, which the agent's
                // auth status does not read: its models are in the pickers.
                let connected = server.is_some()
                    || matches!(
                        row.status.as_ref().map(|status| status.style),
                        Some(AuthStatusStyle::Success)
                    );
                let removable = stored.iter().any(|credential| {
                    credential.id == row.id && credential.auth_type == row.auth_type
                });
                let note = row.status.as_ref().and_then(|status| {
                    let outside = connected && !removable;
                    (outside || status.style == AuthStatusStyle::Warning)
                        .then(|| status.label.clone())
                });
                ProviderEntry {
                    id: row.id.clone(),
                    name: server.map_or_else(|| row.name.clone(), |server| server.name.clone()),
                    method: match row.auth_type {
                        AuthType::Oauth => Method::Subscription,
                        AuthType::ApiKey => Method::ApiKey,
                    },
                    login: match row.flow {
                        AuthFlow::TerminalFlow => Login::Browser,
                        AuthFlow::ApiKeyPrompt => Login::ApiKey,
                    },
                    connected,
                    removable,
                    note,
                    warning: None,
                    local: server.map(|server| LocalEntry {
                        base_url: server.base_url.clone(),
                        models: server.models.clone(),
                        specs: server.specs.clone(),
                    }),
                }
            })
            .collect();
        // The warning follows the credential that triggers it: a stored
        // subscription login, else a subscription token used as the API key.
        if let Some(warning) = warning {
            let uses = |method: Method| {
                entries.iter().position(|entry| {
                    entry.id == "anthropic" && entry.method == method && entry.connected
                })
            };
            if let Some(index) = uses(Method::Subscription).or_else(|| uses(Method::ApiKey)) {
                entries[index].warning = Some(warning.to_string());
            }
        }
        entries
    }
}

/// `local_probe`: the server, or why it could not be read, as a result
/// the client shows.
async fn local_probe(params: &Value) -> Result<Value, String> {
    let base_url = string_param(params, "baseUrl")?;
    let api_key = params.get("apiKey").and_then(Value::as_str);
    Ok(match local::probe(&base_url, api_key).await {
        Ok(server) => json!({ "server": server }),
        Err(error) => json!({ "error": error }),
    })
}

fn local_outcome(written: Result<String, String>) -> ProviderAuthOutcome {
    match written {
        Ok(message) => ProviderAuthOutcome::Status(message),
        Err(message) => ProviderAuthOutcome::Error(message),
    }
}

/// An MCP server's sign-in (`mcp:<server>`): the provider rows leave the
/// MCP servers out, and the flow resolves the server itself (an unknown
/// server, or one without OAuth, fails it).
fn mcp_login_row(provider_id: &str) -> Option<ProviderRow> {
    let server = provider_id.strip_prefix("mcp:")?;
    Some(ProviderRow {
        id: provider_id.to_string(),
        name: server.to_string(),
        auth_type: AuthType::Oauth,
        status: None,
        flow: AuthFlow::TerminalFlow,
        configured: false,
        available: true,
    })
}

fn string_param(params: &Value, name: &str) -> Result<String, String> {
    params
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{name} must be a non-empty string"))
}

fn invalid_params(id: &Value, details: &str) -> Value {
    jsonrpc::error_response(
        id,
        jsonrpc::INVALID_PARAMS,
        "Invalid params",
        Some(&json!({ "details": details })),
    )
}
