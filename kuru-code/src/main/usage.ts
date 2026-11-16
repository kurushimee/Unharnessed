import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import type { UsageReport, UsageTotals } from "@shared/usage";
import { parse, sessionsDir } from "./sessions";

type Reply = { at: number; provider: string; model: string; cost: number; priced: boolean; input: number; output: number; cacheRead: number; cacheWrite: number };
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
      priced: typeof cost?.total === "number",
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

// ---- T3 Code's usage summary (its server.getUsageSummary), from the same session files.

type SummaryInput = {
  sinceDay: string;
  untilDay: string;
  timeZone: string;
  resolution?: "day" | "hour";
  sinceTime?: string;
  untilTime?: string;
  modelFilter?: { include?: { provider?: string; model: string }[]; exclude?: { provider?: string; model: string }[] };
};

const HOUR_MS = 3_600_000;

function dayFormat(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  }
}

function matches(selectors: { provider?: string; model: string }[] | undefined, reply: Reply): boolean {
  return (selectors ?? []).some((selector) => selector.model === reply.model && (selector.provider === undefined || selector.provider === reply.provider));
}

/**
 * What the threads used in a window, as T3 Code's UsageSummary: buckets by day (or hour), provider
 * and model. Unharnessed records each reply's cost itself, so costs are the provider's.
 */
export async function usageSummary(input: SummaryInput, hostId: string) {
  const started = Date.now();
  const dir = sessionsDir();
  const format = dayFormat(input.timeZone);
  const hourly = input.resolution === "hour" && input.sinceTime !== undefined && input.untilTime !== undefined;
  const sinceMs = hourly ? Date.parse(input.sinceTime!) : Number.NEGATIVE_INFINITY;
  const untilMs = hourly ? Date.parse(input.untilTime!) : Number.POSITIVE_INFINITY;
  // The window's first day began at most 14 hours before its UTC midnight (the earliest zone).
  const earliest = Math.max(Date.parse(`${input.sinceDay}T00:00:00Z`) - 14 * HOUR_MS, hourly ? sinceMs : 0);
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    // No sessions yet.
  }
  type Bucket = {
    day: string;
    hourStart?: string;
    provider: string;
    model: string;
    totals: { uncachedInputTokens: number; cachedInputTokens: number; cacheCreationTokens: number; outputTokens: number; reasoningTokens: number };
    costUsd: number;
    cacheSavingsUsd: number;
    costSource: "providerReported" | "unpriced";
    records: number;
    unpricedRecords: number;
    sessions: Set<string>;
  };
  const buckets = new Map<string, Bucket>();
  const sessionsByProvider = new Map<string, Set<string>>();
  let scanned = 0;
  let skipped = 0;
  for (const name of names) {
    const path = join(dir, name);
    let list: Reply[];
    try {
      if ((await stat(path)).mtimeMs < earliest) continue;
      list = await replies(path);
      scanned++;
    } catch {
      skipped++;
      continue;
    }
    for (const reply of list) {
      if (hourly ? reply.at < sinceMs || reply.at >= untilMs : false) continue;
      const day = format.format(new Date(reply.at));
      if (day < input.sinceDay || day > input.untilDay) continue;
      if (input.modelFilter?.include && !matches(input.modelFilter.include, reply)) continue;
      if (matches(input.modelFilter?.exclude, reply)) continue;
      const hourStart = hourly ? new Date(sinceMs + Math.floor((reply.at - sinceMs) / HOUR_MS) * HOUR_MS).toISOString() : undefined;
      const key = JSON.stringify([day, hourStart ?? null, reply.provider, reply.model]);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          day,
          ...(hourStart === undefined ? {} : { hourStart }),
          provider: reply.provider,
          model: reply.model,
          totals: { uncachedInputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 0, reasoningTokens: 0 },
          costUsd: 0,
          cacheSavingsUsd: 0,
          costSource: "unpriced",
          records: 0,
          unpricedRecords: 0,
          sessions: new Set(),
        };
        buckets.set(key, bucket);
      }
      bucket.totals.uncachedInputTokens += reply.input;
      bucket.totals.cachedInputTokens += reply.cacheRead;
      bucket.totals.cacheCreationTokens += reply.cacheWrite;
      bucket.totals.outputTokens += reply.output;
      bucket.costUsd += reply.cost;
      bucket.records++;
      if (reply.priced) bucket.costSource = "providerReported";
      else bucket.unpricedRecords++;
      bucket.sessions.add(name);
      const providerSessions = sessionsByProvider.get(reply.provider) ?? new Set<string>();
      providerSessions.add(name);
      sessionsByProvider.set(reply.provider, providerSessions);
    }
  }
  return {
    contractVersion: 6,
    readAt: new Date().toISOString(),
    timeZone: input.timeZone,
    sinceDay: input.sinceDay,
    untilDay: input.untilDay,
    buckets: [...buckets.values()].map(({ sessions, ...bucket }) => ({ ...bucket, sessions: sessions.size })),
    sources: [...sessionsByProvider].map(([provider, sessions]) => ({
      fingerprint: { hostId, provider, resolvedHomePath: dir, volumeId: "" },
      status: skipped > 0 ? ("partial" as const) : ("ok" as const),
      scannedFiles: scanned,
      skippedFiles: skipped,
      malformedRecords: 0,
      distinctSessions: sessions.size,
      message: null,
    })),
    pricing: usagePricing(),
    scanDurationMs: Date.now() - started,
    ...(input.modelFilter === undefined ? {} : { modelFilter: input.modelFilter }),
  };
}

/** Unharnessed prices each reply itself; there are no rates to fetch. */
export function usagePricing() {
  return { status: "fresh" as const, source: "Unharnessed", fetchedAt: null, knownModels: 0 };
}
