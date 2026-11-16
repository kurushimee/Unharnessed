import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { titleWithoutLinks } from "../../../vscode/src/files";

/** The agent's state folder (crates/uh-types/src/platform/dirs.rs). */
export function agentDir(): string {
  const override = process.env.UNHARNESSED_CODING_AGENT_DIR;
  if (override) return override.replace(/^~(?=$|[\\/])/, homedir());
  return join(homedir(), ".unharnessed");
}

export function sessionsDir(): string {
  return join(agentDir(), "sessions");
}

/** One saved conversation, as its file tells it: what the sidebar shows of a thread. */
export type SessionSummary = {
  id: string;
  path: string;
  cwd: string;
  /** The start of its first prompt; absent when it had only images. */
  title?: string;
  /** When it started, ms. */
  created: number;
  /** Its file's last write, ms. */
  updated: number;
  /** The branch it started on, when its folder is a git repository. */
  branch?: string;
  /** The model it last switched to. */
  provider?: string;
  model?: string;
};

const TITLE_CHARS = 80;
/** How much of a file's start is read for its prompt, and of its end for its model. */
const HEAD_BYTES = 512 * 1024;
const TAIL_BYTES = 256 * 1024;

const cache = new Map<string, { key: string; summary: SessionSummary | null }>();

/**
 * The saved conversations, the newest first, as the agent's `session/list`
 * gives them (crates/uh-daemon/src/acp/history.rs): a file nothing was
 * asked in is not one. Read from the files, so the sidebar has them before
 * any agent runs; a file that did not change is not read again.
 */
export async function listSessions(): Promise<SessionSummary[]> {
  const dir = sessionsDir();
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const found = await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      try {
        const info = await stat(path);
        const key = `${info.size}:${info.mtimeMs}`;
        const known = cache.get(path);
        if (known?.key === key) return known.summary;
        const summary = await readSummary(path, info.size, info.mtimeMs);
        cache.set(path, { key, summary });
        return summary;
      } catch {
        return null;
      }
    }),
  );
  return found.filter((summary): summary is SessionSummary => summary !== null).sort((a, b) => b.updated - a.updated);
}

async function readSummary(path: string, size: number, mtime: number): Promise<SessionSummary | null> {
  const file = await open(path, "r");
  try {
    const head = await readAt(file, 0, Math.min(size, HEAD_BYTES));
    const lines = head.split("\n");
    // The last line of a cut read may be partial.
    if (size > HEAD_BYTES) lines.pop();
    const header = parse(lines[0]);
    if (header?.type !== "session" || typeof header.id !== "string") return null;
    let title: string | undefined;
    let prompted = false;
    let provider: string | undefined;
    let model: string | undefined;
    for (const line of lines.slice(1)) {
      const entry = parse(line);
      if (!entry) continue;
      if (entry.type === "model_change") {
        provider = str(entry.provider);
        model = str(entry.modelId);
      }
      if (prompted) continue;
      const prompt = promptText(entry);
      if (prompt !== undefined) {
        prompted = true;
        title = titleOf(prompt);
      }
    }
    if (!prompted) return null;
    if (size > HEAD_BYTES) {
      const tail = (await readAt(file, size - TAIL_BYTES, TAIL_BYTES)).split("\n").slice(1);
      for (const line of tail) {
        if (!line.includes("model_change")) continue;
        const entry = parse(line);
        if (entry?.type === "model_change") {
          provider = str(entry.provider);
          model = str(entry.modelId);
        }
      }
    }
    const git = header.git as { branch?: unknown } | undefined;
    const created = Date.parse(str(header.timestamp) ?? "");
    return {
      id: header.id,
      path,
      cwd: str(header.cwd) ?? "",
      title: title && titleWithoutLinks(title),
      created: Number.isFinite(created) ? created : mtime,
      updated: mtime,
      branch: str(git?.branch),
      provider,
      model,
    };
  } finally {
    await file.close();
  }
}

async function readAt(file: import("node:fs/promises").FileHandle, position: number, length: number): Promise<string> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, Math.max(0, position));
  return buffer.subarray(0, bytesRead).toString("utf8");
}

/** A user prompt's text, or a slash command's: what the title starts with. */
function promptText(entry: Record<string, unknown>): string | undefined {
  if (entry.type === "message") {
    const message = entry.message as { role?: string; content?: unknown } | undefined;
    if (message?.role === "user") return contentText(message.content);
  }
  if (entry.type === "custom_message") {
    const custom = entry.customType ?? entry.custom_type ?? (entry.payload as Record<string, unknown> | undefined)?.customType;
    if (custom === "session_slash_command") {
      return contentText(entry.content ?? (entry.payload as Record<string, unknown> | undefined)?.content);
    }
  }
  return undefined;
}

export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text: string } => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function titleOf(prompt: string): string | undefined {
  const line = prompt.split(/\s+/).filter(Boolean).join(" ");
  if (!line) return undefined;
  const chars = [...line];
  if (chars.length <= TITLE_CHARS) return line;
  return `${chars.slice(0, TITLE_CHARS - 1).join("").trimEnd()}…`;
}

export function parse(line: string | undefined): Record<string, unknown> | null {
  if (!line) return null;
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
