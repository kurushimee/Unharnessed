// Thread titles, as T3 Code writes them (packages/provider-core/src/server/
// textGenerationPrompts.ts buildThreadTitlePrompt, textGenerationUtils.ts
// sanitizeThreadTitle, threadTitleContext.ts limitTitleMessage, and
// apps/server/src/orchestration-v2/ThreadTitleRegenerationService.ts): one request
// for the first message of a new thread, to the model the "Text generation" setting
// names, through the agent's `_unharnessed/complete` (its providers and sign-ins).
// The agent has no tools for it, so the prompt drops T3 Code's line about them.
import type { Attachment } from "@shared/protocol";

const INITIAL_THREAD_TITLE_PROMPT = `Generate a title that will help the user recognize this kuru code thread weeks later.
Return JSON with keys title and needsRefinement.
Set needsRefinement to true only if the subject is still unknown, such as an unresolved link, "fix this", or an unexplained attachment. Otherwise set it to false.

Before answering, silently reduce the request to:
- Subject: What system, feature, or problem is this really about?
- Outcome: What does the user ultimately want to understand or change?
- Incidental instructions: What only describes how the agent should do the work?

Title the subject and outcome. Discard incidental instructions.

Editorial rules:
- 3-8 words, fewer than 40 characters.
- Use a compact noun phrase or clear action phrase.
- Capture the umbrella goal when the request lists several symptoms or steps.
- Name the product change, not the mock, plan, report, branch, or PR used to produce it.
- Models, subagents, tools, output formats, and monitoring instructions do not belong in the title unless they are themselves the topic.
- For reviews, name what is being reviewed and the relevant concern. Avoid generic titles such as "Review PR 123" when linked or attached context reveals the subject.
- For research, name the question domain rather than the requested research process.
- Do not claim the work is complete.
- Do not copy and truncate the user's message.
- Avoid project names already visible in the UI, quotes, labels, filler, and trailing punctuation.
- Use attached images as primary context for UI issues.
- Local git history is not evidence of what a linked PR or issue is about. Never title the thread after branch names, commit messages, or merged commits found in the checkout.
- If a linked PR or issue cannot be read, fall back to the user's stated action plus its number, such as "Take Over PR 8588". This is the one case where a PR or issue number belongs in the title.`;

const TRUNCATED = "\n[Content truncated]\n";
const MAX_THREAD_TITLE_CHARS = 120;
/** T3 Code's own placeholder: a title the model could not write. */
const NO_TITLE = "New thread";

function limitTitleMessage(text: string, budget: number): string {
  if (text.length <= budget) return text;
  if (budget <= TRUNCATED.length) return "";
  const available = budget - TRUNCATED.length;
  let head = Math.ceil(available / 2);
  let tail = available - head;
  // Half an emoji serializes to a lone surrogate escape, which provider JSON parsers reject.
  const last = text.charCodeAt(head - 1);
  if (last >= 0xd800 && last <= 0xdbff) head -= 1;
  const first = text.charCodeAt(text.length - tail);
  if (tail > 0 && first >= 0xdc00 && first <= 0xdfff) tail -= 1;
  return `${text.slice(0, head)}${TRUNCATED}${tail > 0 ? text.slice(-tail) : ""}`;
}

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const last = value.charCodeAt(maxChars - 1);
  const truncated = value.slice(0, last >= 0xd800 && last <= 0xdbff ? maxChars - 1 : maxChars);
  return `${truncated}\n\n[truncated]`;
}

function titlePrompt(message: string, images: ReadonlyArray<Attachment>, instructions: string): string {
  let prompt = `${INITIAL_THREAD_TITLE_PROMPT}\n\nUser message:\n${limitTitleMessage(message, 8_000)}`;
  const trimmed = instructions.trim();
  if (trimmed) prompt += `\n\nAdditional instructions:\n${limitSection(trimmed, 20_000)}`;
  const lines = images.map(
    (image) => `- ${image.name} (${image.mimeType}, ${Math.floor((image.data.length * 3) / 4)} bytes)`,
  );
  if (lines.length > 0) prompt += `\n\nAttachment metadata:\n${limitSection(lines.join("\n"), 4_000)}`;
  return prompt;
}

/** The model's title, unwrapped from its JSON, on one line, at most 120 characters. */
export function sanitizeThreadTitle(raw: string): string {
  let title = raw;
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as { title?: unknown };
      if (typeof parsed.title === "string") title = parsed.title;
    } catch {
      // Not JSON: the text is the title.
    }
  }
  const normalized = (title.trim().split(/\r?\n/g)[0] ?? "")
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) return NO_TITLE;
  if (normalized.length <= MAX_THREAD_TITLE_CHARS) return normalized;
  let end = MAX_THREAD_TITLE_CHARS - 3;
  const previous = normalized.charCodeAt(end - 1);
  const next = normalized.charCodeAt(end);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
  return `${normalized.slice(0, end).trimEnd()}...`;
}

/** The "Text generation" setting: T3 Code's model selection, kept by the window. */
export type TitleModel = {
  readonly instanceId?: unknown;
  readonly model?: unknown;
  readonly options?: ReadonlyArray<{ readonly id?: unknown; readonly value?: unknown }>;
};

type Request = (method: string, params: Record<string, unknown>) => Promise<{ text?: unknown }>;

/** The agent refused the request's parameters (an unknown model or effort), as JSON-RPC says. */
function refusedParams(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === -32602;
}

/**
 * A title for a new thread's first message, or undefined when there is none to
 * give (T3 Code keeps the thread's plain title then). Tried three times, 2 s and
 * 4 s apart, as T3 Code does. A chosen model the agent does not know falls back
 * to the agent's own (its summary model, else its default one).
 */
export async function generateThreadTitle(
  request: Request,
  input: {
    readonly message: string;
    readonly images: ReadonlyArray<Attachment>;
    readonly instructions: string;
    readonly model: TitleModel | null;
  },
): Promise<string | undefined> {
  if (input.message.trim().length === 0 && input.images.length === 0) return undefined;
  const params: Record<string, unknown> = {
    prompt: titlePrompt(input.message, input.images, input.instructions),
    images: input.images.map((image) => ({ data: image.data, mimeType: image.mimeType })),
  };
  const chosen: Record<string, unknown> = {};
  const { instanceId, model, options } = input.model ?? {};
  if (typeof instanceId === "string" && typeof model === "string" && instanceId && model) {
    chosen.model = `${instanceId}/${model}`;
    const effort = options?.find((option) => option.id === "thought_level")?.value;
    if (typeof effort === "string") chosen.reasoning = effort;
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** (attempt - 1)));
    try {
      let answer: { text?: unknown };
      try {
        answer = await request("_unharnessed/complete", { ...params, ...chosen });
      } catch (error) {
        if (!refusedParams(error) || Object.keys(chosen).length === 0) throw error;
        answer = await request("_unharnessed/complete", params);
      }
      const title = sanitizeThreadTitle(typeof answer.text === "string" ? answer.text : "");
      return title === NO_TITLE ? undefined : title;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
