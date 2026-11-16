import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import type { UsageReport, UsageTotals } from "@shared/usage";
import { parse, sessionsDir } from "./sessions";

type Reply = { at: number; provider: string; model: string; cost: number; input: number; output: number; cacheRead: number; cacheWrite: number };
const cache = new Map<string, { key: string; replies: Reply[] }>();

const empty = (): UsageTotals => ({ cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, replies: 0 });

function add(totals: UsageTotals, reply: Reply): void {
  totals.cost += reply.cost;
  totals.input += reply.input;
  totals.output += reply.output;
  totals.cacheRead += reply.cacheRead;
  totals.cacheWrite += reply.cacheWrite;
  totals.replies++;
}

/** Every reply of a session file with its usage (the agent writes it on each assistant message). */
async function replies(path: string): Promise<Reply[]> {
  const info = await stat(path);
  const key = `${info.size}:${info.mtimeMs}`;
  const known = cache.get(path);
  if (known?.key === key) return known.replies;
  const found: Reply[] = [];
  const text = await readFile(path, "utf8");
  for (const line of text.split("\n")) {
    if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;
    const entry = parse(line);
    const message = entry?.message as
      | { role?: string; provider?: string; model?: string; timestamp?: number; usage?: Record<string, unknown> }
      | undefined;
    if (entry?.type !== "message" || message?.role !== "assistant" || !message.usage) continue;
    const usage = message.usage;
    const cost = usage.cost as { total?: number } | undefined;
    const at = typeof message.timestamp === "number" ? message.timestamp : Date.parse(String(entry.timestamp ?? ""));
    found.push({
      at: Number.isFinite(at) ? at : info.mtimeMs,
      provider: message.provider ?? "unknown",
      model: message.model ?? "unknown",
      cost: Number(cost?.total) || 0,
      input: Number(usage.input) || 0,
      output: Number(usage.output) || 0,
      cacheRead: Number(usage.cacheRead) || 0,
      cacheWrite: Number(usage.cacheWrite) || 0,
    });
  }
  cache.set(path, { key, replies: found });
  return found;
}

function dayOf(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** What the threads used in the last `days` days. */
export async function usageReport(days: number): Promise<UsageReport> {
  const dir = sessionsDir();
  const since = Date.now() - days * 86_400_000;
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    // No sessions yet.
  }
  const totals = empty();
  const models = new Map<string, UsageReport["models"][number] & { ids: Set<string> }>();
  const providers = new Map<string, UsageReport["providers"][number] & { ids: Set<string> }>();
  const daily = new Map<string, UsageReport["daily"][number]>();
  for (let at = since; at <= Date.now() + 86_400_000; at += 86_400_000) {
    const day = dayOf(Math.min(at, Date.now()));
    if (!daily.has(day)) daily.set(day, { day, ...empty() });
  }
  const sessions = new Set<string>();
  for (const name of names) {
    const path = join(dir, name);
    let list: Reply[];
    try {
      if ((await stat(path)).mtimeMs < since) continue;
      list = await replies(path);
    } catch {
      continue;
    }
    for (const reply of list) {
      if (reply.at < since) continue;
      sessions.add(name);
      add(totals, reply);
      const key = `${reply.provider}/${reply.model}`;
      const model = models.get(key) ?? { key, provider: reply.provider, model: reply.model, sessions: 0, ids: new Set<string>(), ...empty() };
      add(model, reply);
      model.ids.add(name);
      models.set(key, model);
      const provider = providers.get(reply.provider) ?? { provider: reply.provider, sessions: 0, ids: new Set<string>(), ...empty() };
      add(provider, reply);
      provider.ids.add(name);
      providers.set(reply.provider, provider);
      const day = daily.get(dayOf(reply.at));
      if (day) add(day, reply);
    }
  }
  const strip = <T extends { ids: Set<string>; sessions: number }>({ ids, ...rest }: T) => ({ ...rest, sessions: ids.size });
  const byCost = (a: UsageTotals, b: UsageTotals) => b.cost - a.cost || b.input + b.output + b.cacheRead - (a.input + a.output + a.cacheRead);
  return {
    days,
    sessions: sessions.size,
    totals,
    models: [...models.values()].map(strip).sort(byCost),
    providers: [...providers.values()].map(strip).sort(byCost),
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}
