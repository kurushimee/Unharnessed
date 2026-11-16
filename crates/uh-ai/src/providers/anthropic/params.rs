//! Anthropic Messages request params assembly.
//! Section of the port of `packages/ai/src/providers/anthropic.ts`.

use serde_json::{json, Map, Value};

use crate::providers::anthropic::convert::{convert_messages, convert_tools};
use crate::providers::anthropic::{
    feature_id, get_anthropic_compat, is_always_on_adaptive_thinking_model,
    supports_adaptive_thinking, AnthropicOptions, AnthropicThinkingDisplay, CacheControl,
};
use crate::types::{Context, Model, SESSION_TAIL_PREFIX};
use crate::utils_inner::sanitize_unicode::sanitize_surrogates;

// Long by design (a 1:1 port of the upstream provider shape); refactoring is out of scope for the zero-behavior pedantic sweep.
#[allow(clippy::too_many_lines)]
pub(crate) fn build_params(
    model: &Model,
    context: &Context,
    is_oauth_token: bool,
    options: Option<&AnthropicOptions>,
    cache_control: Option<&CacheControl>,
) -> Value {
    let base = options
        .map(|options| options.base.clone())
        .unwrap_or_default();
    let features = feature_id(model);
    let always_thinks = is_always_on_adaptive_thinking_model(&features);

    let mut params = Map::new();
    params.insert("model".into(), json!(model.id));
    params.insert(
        "messages".into(),
        json!(convert_messages(
            context,
            model,
            is_oauth_token,
            cache_control
        )),
    );
    params.insert(
        "max_tokens".into(),
        json!(base.max_tokens.unwrap_or(model.max_tokens / 3)),
    );
    params.insert("stream".into(), json!(true));

    // For OAuth tokens, we MUST include Claude Code identity.
    if is_oauth_token {
        let mut system = vec![json!({
            "type": "text",
            "text": "You are Claude Code, Anthropic's official CLI for Claude.",
        })];
        if let Some(cache_control) = cache_control {
            system[0]
                .as_object_mut()
                .expect("system entry is an object")
                .insert("cache_control".into(), cache_control.to_json());
        }
        if let Some(system_prompt) = &context.system_prompt {
            system.extend(system_prompt_blocks(system_prompt, cache_control));
        }
        params.insert("system".into(), json!(system));
    } else if let Some(system_prompt) = &context.system_prompt {
        params.insert(
            "system".into(),
            json!(system_prompt_blocks(system_prompt, cache_control)),
        );
    }

    // Temperature is incompatible with extended thinking (adaptive or
    // budget-based), and always-on models reject sampling params outright.
    if let Some(temperature) = base.temperature {
        if options.map(|options| options.thinking_enabled) != Some(Some(true)) && !always_thinks {
            params.insert("temperature".into(), json!(temperature));
        }
    }

    if let Some(tools) = &context.tools {
        if !tools.is_empty() {
            params.insert(
                "tools".into(),
                json!(convert_tools(
                    tools,
                    is_oauth_token,
                    get_anthropic_compat(model).supports_eager_tool_input_streaming,
                    cache_control,
                )),
            );
        }
    }

    // Configure thinking mode: adaptive, budget-based, or explicitly disabled.
    if model.reasoning {
        if options.map(|options| options.thinking_enabled) == Some(Some(true)) {
            let display = options
                .and_then(|options| options.thinking_display)
                .unwrap_or(AnthropicThinkingDisplay::Summarized);
            if supports_adaptive_thinking(&features) {
                params.insert(
                    "thinking".into(),
                    json!({ "type": "adaptive", "display": display.as_str() }),
                );
                if let Some(effort) = options.and_then(|options| options.effort) {
                    params.insert("output_config".into(), json!({ "effort": effort.as_str() }));
                }
            } else {
                params.insert(
                    "thinking".into(),
                    json!({
                        "type": "enabled",
                        "budget_tokens": options.and_then(|options| options.thinking_budget_tokens).unwrap_or(1024),
                        "display": display.as_str(),
                    }),
                );
            }
        } else if options.map(|options| options.thinking_enabled) == Some(Some(false))
            && !always_thinks
        {
            params.insert("thinking".into(), json!({ "type": "disabled" }));
        }
    }

    if let Some(metadata) = &base.metadata {
        if let Some(user_id) = metadata.get("user_id").and_then(|value| value.as_str()) {
            params.insert("metadata".into(), json!({ "user_id": user_id }));
        }
    }

    if let Some(tool_choice) = options.and_then(|options| options.tool_choice.as_ref()) {
        params.insert("tool_choice".into(), tool_choice.to_json());
    }

    Value::Object(params)
}

/// The system prompt as text blocks. With caching, the breakpoint ends the
/// head before the per-session tail, so every session reuses the head; the
/// tail is cached with the conversation by the last-user-message breakpoint.
fn system_prompt_blocks(system_prompt: &str, cache_control: Option<&CacheControl>) -> Vec<Value> {
    let text = sanitize_surrogates(system_prompt);
    let Some(cache_control) = cache_control else {
        return vec![json!({ "type": "text", "text": text })];
    };
    match text.rfind(&format!("\n{SESSION_TAIL_PREFIX}")) {
        Some(at) if at > 0 => vec![
            json!({
                "type": "text",
                "text": &text[..at],
                "cache_control": cache_control.to_json(),
            }),
            json!({ "type": "text", "text": &text[at + 1..] }),
        ],
        _ => vec![json!({
            "type": "text",
            "text": text,
            "cache_control": cache_control.to_json(),
        })],
    }
}
