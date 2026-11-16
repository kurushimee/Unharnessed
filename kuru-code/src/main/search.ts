// Thread search over the session files' messages, as T3 Code's server
// searches its message table (apps/server/src/orchestration-v2/ThreadSearch.ts):
// one best message per thread, matched and graded by T3 Code's
// messageMatcher, with a snippet starting a few words before the match.
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { messageMatcher, messageSearchTokens } from "../renderer/shared/paletteSearch";
import { contentText, parse } from "./sessions";

export type SearchMatch = {
  threadId: string;
  projectId: string | null;
  source: "user" | "assistant";
  snippet: string;
  messageCreatedAt: string | null;
  quality: number;
  hits: number;
  messageId: string;
};

type Message = { id: string; source: "user" | "assistant"; text: string; at: string | null };

const SNIPPET_LENGTH = 240;
const SNIPPET_LEAD = 24;
const MARKDOWN_LINK = /!?\[([^\]\n]*)\]\([^)\s]*\)/g;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** From T3 Code's ThreadSearch.ts. */
export function buildSearchSnippet(text: string, matchStart: number): string {
  let start = Math.max(0, matchStart - SNIPPET_LEAD);
  const wordStart = text.slice(start, matchStart).search(/\s/);
  if (start > 0 && wordStart !== -1) start += wordStart + 1;
  if (isLowSurrogate(text.charCodeAt(start))) start++;
  const rawEnd = Math.min(text.length, start + SNIPPET_LENGTH * 2);
  const shown = text
    .slice(start, rawEnd)
    .replace(/\*\*|`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  let end = Math.min(shown.length, SNIPPET_LENGTH - 2);
  if (isLowSurrogate(shown.charCodeAt(end))) end--;
  const cut = end < shown.length || rawEnd < text.length;
  return `${start > 0 ? "…" : ""}${shown.slice(0, end)}${cut ? "…" : ""}`;
}

const cache = new Map<string, { key: string; messages: Message[] }>();

async function messagesOf(path: string): Promise<Message[]> {
  const info = await stat(path);
  const key = `${info.size}:${info.mtimeMs}`;
  const known = cache.get(path);
  if (known?.key === key) return known.messages;
  const messages: Message[] = [];
  const lines = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.startsWith('{"type":"message"')) continue;
    const entry = parse(line);
    const message = entry?.message as { role?: string; content?: unknown } | undefined;
    if (message?.role !== "user" && message?.role !== "assistant") continue;
    const text = contentText(message.content).trim();
    if (!text) continue;
    messages.push({
      id: typeof entry?.id === "string" ? entry.id : String(messages.length),
      source: message.role,
      text: text.replace(MARKDOWN_LINK, "$1"),
      at: typeof entry?.timestamp === "string" ? entry.timestamp : null,
    });
  }
  cache.set(path, { key, messages });
  return messages;
}

/** The best message match of each thread, newest messages first on ties. */
export async function searchThreads(
  query: string,
  sessions: ReadonlyArray<{ id: string; path: string; projectId: string | null }>,
  limit = 50,
): Promise<SearchMatch[]> {
  if (messageSearchTokens(query).long.length === 0) return [];
  const match = messageMatcher(query);
  const found: SearchMatch[] = [];
  for (const session of sessions) {
    let messages: Message[];
    try {
      messages = await messagesOf(session.path);
    } catch {
      continue;
    }
    let best: { message: Message; quality: number; offset: number } | null = null;
    let hits = 0;
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]!;
      const result = match(message.text);
      if (result === null) continue;
      if (best === null || result.quality > best.quality) {
        best = { message, quality: result.quality, offset: result.offset };
        hits = 1;
      } else if (result.quality === best.quality) {
        hits++;
        // What the user wrote is what they remember asking.
        if (best.message.source !== "user" && message.source === "user") {
          best = { message, quality: result.quality, offset: result.offset };
        }
      }
    }
    if (best === null) continue;
    found.push({
      threadId: session.id,
      projectId: session.projectId,
      source: best.message.source,
      snippet: buildSearchSnippet(best.message.text, best.offset),
      messageCreatedAt: best.message.at,
      quality: best.quality,
      hits,
      messageId: best.message.id,
    });
  }
  found.sort(
    (left, right) =>
      right.quality - left.quality || (right.messageCreatedAt ?? "").localeCompare(left.messageCreatedAt ?? ""),
  );
  return found.slice(0, limit);
}
