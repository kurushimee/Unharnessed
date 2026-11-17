//! One request to a model outside the conversation, for short text the
//! window writes itself (a thread's title).
//!
//! `_unharnessed/complete` `{ prompt, images?, system?, model?, reasoning?, maxTokens? }`
//! answers `{ text, model }`: `model` is a `provider/id` selector, the
//! `auxiliaryModel` setting when absent, else the default model; `reasoning`
//! one of `off`...`max`, the provider's default when absent; `images`
//! `[{ data, mimeType }]`, base64, after the prompt. No tools, and
//! nothing reaches the session file. Refused when the model is unknown, not
//! signed in or outside `allowedModels` (`-32602`, `data.details`), or when
//! the request fails (`-32603`).

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};

use super::{internal_error, jsonrpc, producer};
use uh_core::session_engine::auxiliary_model::{
    default_one_off_selector, resolve_model_selector, AuxiliaryModelContext,
};

pub(super) const COMPLETE: &str = "_unharnessed/complete";

/// Enough room for a reasoning model's thinking before a short answer.
const DEFAULT_MAX_TOKENS: u64 = 4096;

pub(super) async fn handle_complete(
    id: Value,
    params: Value,
    cwd: Arc<PathBuf>,
    agent_dir: Arc<PathBuf>,
    tx: producer::FrameSink,
) {
    let invalid = |details: String| {
        jsonrpc::error_response(
            &id,
            jsonrpc::INVALID_PARAMS,
            "Invalid params",
            Some(&json!({ "details": details })),
        )
    };
    let Some(prompt) = params
        .get("prompt")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        let _ = tx.send(invalid("`prompt` is missing.".to_string()));
        return;
    };
    let reasoning = match params.get("reasoning") {
        None | Some(Value::Null) => None,
        Some(value) => {
            if let Ok(level) =
                serde_json::from_value::<uh_types::ai::ModelThinkingLevel>(value.clone())
            {
                Some(level)
            } else {
                let _ = tx.send(invalid(format!("Unknown reasoning level {value}.")));
                return;
            }
        }
    };
    let max_tokens = params
        .get("maxTokens")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_MAX_TOKENS);
    let system = params
        .get("system")
        .and_then(Value::as_str)
        .map(str::to_string);
    let named = params
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(str::to_string);
    let context = AuxiliaryModelContext {
        cwd: cwd.as_ref().clone(),
        agent_dir: agent_dir.as_ref().clone(),
    };
    // The registry reads settings, models.json and auth storage from disk.
    let resolved = tokio::task::spawn_blocking(move || {
        let selector = named
            .or_else(|| default_one_off_selector(&context))
            .ok_or_else(|| "No model is set.".to_string())?;
        resolve_model_selector(&context, &selector)
    })
    .await
    .unwrap_or_else(|error| Err(error.to_string()));
    let resolved = match resolved {
        Ok(resolved) => resolved,
        Err(details) => {
            let _ = tx.send(invalid(details));
            return;
        }
    };
    let images: Vec<uh_types::ai::UserContentBlock> = params
        .get("images")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|image| {
            Some(uh_types::ai::UserContentBlock::Image(
                uh_types::ai::ImageContent {
                    data: image.get("data")?.as_str()?.to_string(),
                    mime_type: image.get("mimeType")?.as_str()?.to_string(),
                    rest: serde_json::Map::default(),
                },
            ))
        })
        .collect();
    let user_content = if images.is_empty() {
        uh_types::ai::UserContent::Text(prompt)
    } else {
        let mut blocks = vec![uh_types::ai::UserContentBlock::Text(
            uh_types::ai::TextContent {
                text: prompt,
                text_signature: None,
                rest: serde_json::Map::default(),
            },
        )];
        blocks.extend(images);
        uh_types::ai::UserContent::Blocks(blocks)
    };
    let context = uh_types::ai::Context {
        system_prompt: system,
        messages: vec![uh_types::ai::Message::User(uh_types::ai::UserMessage {
            content: user_content,
            timestamp: u64::try_from(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |elapsed| elapsed.as_millis()),
            )
            .unwrap_or(0),
            rest: serde_json::Map::default(),
        })],
        tools: None,
    };
    let mut options = uh_ai::types::SimpleStreamOptions::from_base(uh_ai::types::StreamOptions {
        max_tokens: Some(max_tokens),
        api_key: resolved.api_key,
        headers: resolved
            .headers
            .map(|headers| headers.into_iter().collect()),
        ..Default::default()
    });
    options.reasoning = reasoning;
    let selector = format!("{}/{}", resolved.model.provider, resolved.model.id);
    let assistant = match uh_ai::complete_simple(&resolved.model, &context, Some(options)).await {
        Ok(assistant) => assistant,
        Err(error) => {
            let _ = tx.send(internal_error(&id, &format!("{selector}: {error:#}")));
            return;
        }
    };
    if assistant.stop_reason == uh_types::ai::StopReason::Error {
        let why = assistant
            .error_message
            .as_deref()
            .unwrap_or("the request failed");
        let _ = tx.send(internal_error(&id, &format!("{selector}: {why}")));
        return;
    }
    let text = assistant
        .content
        .iter()
        .filter_map(|block| match block {
            uh_types::ai::AssistantContentBlock::Text(text) => Some(text.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    let _ = tx.send(jsonrpc::response(
        &id,
        &json!({ "text": text, "model": selector }),
    ));
}
