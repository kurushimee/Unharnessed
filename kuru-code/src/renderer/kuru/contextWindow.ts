// T3 Code reads a thread's context from its provider's token reports; kuru code's agent
// reports it on the chat (`ChatState.usage`). This gives it T3 Code's shape, dated when the
// conversation last worked, so the composer offers to compact a thread left idle.
import type { ChatState } from "@shared/protocol";
import type { ContextWindowSnapshot } from "~/rt/state/contextWindow";

/** The context of `chat`, as its agent last measured it; none before a reply measured it. */
export function chatContextWindow(
  usage: ChatState["usage"],
  entries: ChatState["entries"],
): ContextWindowSnapshot | null {
  if (!usage || usage.tokens === undefined) return null;
  const usedTokens = Math.max(0, usage.tokens);
  const maxTokens = usage.window > 0 ? usage.window : null;
  const usedPercentage = maxTokens !== null ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
  // When the conversation last worked: its last turn's end, or its start while it has no end.
  let lastAt = 0;
  for (const entry of entries) {
    if (entry.kind === "turn" && entry.at !== undefined) lastAt = Math.max(lastAt, entry.at + (entry.ms ?? 0));
  }
  return {
    usedTokens,
    totalProcessedTokens: null,
    maxTokens,
    remainingTokens: maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null,
    usedPercentage,
    remainingPercentage: usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    lastUsedTokens: null,
    lastInputTokens: null,
    lastCachedInputTokens: null,
    lastOutputTokens: null,
    lastReasoningOutputTokens: null,
    toolUses: null,
    durationMs: null,
    compactsAutomatically: usage.compactAt !== undefined,
    autoCompactThreshold: usage.compactAt ?? null,
    cost: null,
    updatedAt: lastAt > 0 ? new Date(lastAt).toISOString() : "",
  };
}
