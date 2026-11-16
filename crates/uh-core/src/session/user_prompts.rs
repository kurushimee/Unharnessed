//! The user's own prompts survive compaction verbatim.
//!
//! A compaction replaces everything before its cut with a model-written
//! summary, and a summary paraphrases: the instructions, constraints and
//! corrections the user typed get condensed or dropped, and the agent
//! forgets what it is working on. So every compaction also records the
//! user's prompts that it summarized away, word for word and in order (the
//! previous compaction's list, then the new ones), and the rebuilt context
//! shows them next to the summary.
//!
//! The list rides the compaction entry's `details` under
//! [`USER_PROMPTS_DETAILS_KEY`]: a windowed resume loads only the entries
//! after the latest compaction's boundary, so the older prompts must live
//! on that entry itself.
//!
//! A prior compaction written before the list existed has none, but the
//! prompts it summarized away are still in the session file: the next
//! compaction then rebuilds the whole list from the branch, root to cut
//! ([`branch_user_prompts`]).

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;

use uh_types::ai::{UserContent, UserContentBlock};
use uh_types::session::{AgentMessage, CompactionEntry, FileEntry};

/// The `details` key holding the summarized-away user prompts.
pub const USER_PROMPTS_DETAILS_KEY: &str = "userPrompts";

/// The `details` key saying the list is every prompt before the cut. The
/// first build that recorded lists started each from the prior entry's,
/// so after entries with no list its lists miss the prompts those
/// summarized away; a list without this mark is rebuilt from the file.
pub const USER_PROMPTS_COMPLETE_KEY: &str = "userPromptsComplete";

/// What a non-text block of a user prompt becomes in the verbatim list.
const IMAGE_PLACEHOLDER: &str = "[image]";

/// A user prompt as the user wrote it: its text blocks in order, an image
/// replaced by `[image]` (the bytes would cost the context they are kept
/// out of). `None` for a prompt with nothing in it.
#[must_use]
pub fn prompt_text(content: &UserContent) -> Option<String> {
    let text = match content {
        UserContent::Text(text) => text.clone(),
        UserContent::Blocks(blocks) => blocks
            .iter()
            .filter_map(|block| match block {
                UserContentBlock::Image(_) => Some(IMAGE_PLACEHOLDER.to_string()),
                other => other.text().map(str::to_string),
            })
            .collect::<Vec<_>>()
            .join("\n"),
    };
    (!text.trim().is_empty()).then_some(text)
}

/// The user's prompt an entry holds. Harness notices are `custom_message`
/// rows, never `user` messages, so they hold none.
fn entry_prompt(entry: &FileEntry) -> Option<String> {
    match entry {
        FileEntry::Message {
            message: AgentMessage::User(user),
            ..
        } => prompt_text(&user.content),
        _ => None,
    }
}

/// The user prompts among `entries`, in order.
#[must_use]
pub fn collect_user_prompts(entries: &[FileEntry]) -> Vec<String> {
    entries.iter().filter_map(entry_prompt).collect()
}

/// Every user prompt on the branch that leads to the entry `cut_id`, root
/// first, the cut entry itself excluded. `entries` is every entry known
/// (the session file's, then the loaded ones; a later duplicate wins).
/// `None` when `cut_id` is not among them.
#[must_use]
pub fn branch_user_prompts<'a>(
    entries: impl IntoIterator<Item = &'a FileEntry>,
    cut_id: &str,
) -> Option<Vec<String>> {
    let by_id: HashMap<&str, &FileEntry> = entries
        .into_iter()
        .filter_map(|entry| entry.id().map(|id| (id, entry)))
        .collect();
    let mut parent = by_id.get(cut_id)?.parent_id();
    let mut seen = HashSet::new();
    let mut prompts = Vec::new();
    while let Some(id) = parent {
        // A damaged file could loop its parent links.
        if !seen.insert(id) {
            break;
        }
        let Some(entry) = by_id.get(id) else { break };
        prompts.extend(entry_prompt(entry));
        parent = entry.parent_id();
    }
    prompts.reverse();
    Some(prompts)
}

/// The user prompts a compaction entry recorded (what the model sees beside
/// its summary; possibly incomplete, see [`complete_compaction_user_prompts`]).
#[must_use]
pub fn compaction_user_prompts(entry: &CompactionEntry) -> Option<Vec<String>> {
    entry
        .details
        .as_ref()
        .and_then(|details| details.get(USER_PROMPTS_DETAILS_KEY))
        .and_then(|prompts| prompts.as_array())
        .map(|prompts| {
            prompts
                .iter()
                .filter_map(|prompt| prompt.as_str().map(str::to_string))
                .collect()
        })
}

/// The user prompts a compaction entry recorded, when they are known to be
/// every prompt before its cut; `None` otherwise (no list, or one from the
/// build before [`USER_PROMPTS_COMPLETE_KEY`]).
#[must_use]
pub fn complete_compaction_user_prompts(entry: &CompactionEntry) -> Option<Vec<String>> {
    let complete = entry
        .details
        .as_ref()
        .and_then(|details| details.get(USER_PROMPTS_COMPLETE_KEY))
        .and_then(serde_json::Value::as_bool)
        == Some(true);
    complete.then(|| compaction_user_prompts(entry)).flatten()
}

/// Record `prompts` (every prompt before the cut) on a compaction entry's `details`.
pub fn set_compaction_user_prompts(entry: &mut CompactionEntry, prompts: Vec<String>) {
    let mut details = match entry.details.take() {
        Some(serde_json::Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    };
    details.insert(
        USER_PROMPTS_DETAILS_KEY.to_string(),
        serde_json::Value::from(prompts),
    );
    details.insert(
        USER_PROMPTS_COMPLETE_KEY.to_string(),
        serde_json::Value::Bool(true),
    );
    entry.details = Some(serde_json::Value::Object(details));
}

/// The summary text the model sees: the summary, then the summarized-away
/// user prompts verbatim. With no recorded prompts the summary is
/// unchanged.
#[must_use]
pub fn summary_with_user_prompts(summary: &str, prompts: &[String]) -> String {
    if prompts.is_empty() {
        return summary.to_string();
    }
    let listed: usize = prompts.iter().map(|prompt| prompt.len() + 48).sum();
    let mut out = String::with_capacity(summary.len() + listed + 256);
    out.push_str(summary);
    out.push_str(
        "\n\n<user-prompts>\nEvery message the user wrote before this point, verbatim and in order \
         (the retained messages below hold the later ones). These are the user's own words: \
         where the summary differs from them, they are authoritative.\n",
    );
    for (index, prompt) in prompts.iter().enumerate() {
        let _ = write!(out, "\n<user-prompt n=\"{}\">\n", index + 1);
        out.push_str(prompt);
        out.push_str("\n</user-prompt>\n");
    }
    out.push_str("</user-prompts>");
    out
}
