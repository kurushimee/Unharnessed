import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LogOutputChannel } from "vscode";
import type { LimitWindow, ProviderLimits } from "@shared/usage";
import { agentDir } from "./sessions";

type OAuth = { type?: string; access?: string; expires?: number; accountId?: string; account_id?: string };

/**
 * The subscriptions' usage limits, for the Usage page: ChatGPT (Codex) and
 * Claude, asked with the agent's own sign-in (auth.json), read only. A
 * token past its expiry is not refreshed here: the agent refreshes it on
 * its next request, and the page says so meanwhile.
 */
export class Limits {
  constructor(private readonly log: LogOutputChannel) {}

  async read(): Promise<ProviderLimits[]> {
    let auth: Record<string, OAuth> = {};
    try {
      auth = JSON.parse(await readFile(join(agentDir(), "auth.json"), "utf8")) as Record<string, OAuth>;
    } catch {
      return [];
    }
    const found: Promise<ProviderLimits>[] = [];
    for (const [provider, credential] of Object.entries(auth)) {
      if (credential?.type !== "oauth" || !credential.access) continue;
      if (provider === "openai-codex") found.push(this.guard(provider, "ChatGPT", credential, codex));
      if (provider === "anthropic") found.push(this.guard(provider, "Claude", credential, claude));
    }
    return Promise.all(found);
  }

  private async guard(
    provider: string,
    name: string,
    credential: OAuth,
    read: (credential: OAuth) => Promise<LimitWindow[]>,
  ): Promise<ProviderLimits> {
    if (credential.expires !== undefined && credential.expires < Date.now()) {
      return { provider, name, windows: [], error: "The sign-in token expired; it is renewed with the agent's next request." };
    }
    try {
      const windows = await read(credential);
      this.log.info(`limits: ${provider}: ${windows.map((window) => `${window.label} ${Math.round(window.usedPercent)}%`).join(", ") || "none"}`);
      return { provider, name, windows };
    } catch (error) {
      this.log.warn(`limits: ${provider}: ${String(error)}`);
      return { provider, name, windows: [], error: String(error instanceof Error ? error.message : error) };
    }
  }
}

async function getJson(url: string, headers: Record<string, string>): Promise<Record<string, any>> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as Record<string, any>;
}

async function codex(credential: OAuth): Promise<LimitWindow[]> {
  const headers: Record<string, string> = { Authorization: `Bearer ${credential.access}`, "User-Agent": "kuru-code" };
  const account = credential.accountId ?? credential.account_id;
  if (account) headers["chatgpt-account-id"] = account;
  const body = await getJson("https://chatgpt.com/backend-api/wham/usage", headers);
  const limit = body.rate_limit ?? {};
  const windows: LimitWindow[] = [];
  for (const [key, label] of [["primary_window", "Session"], ["secondary_window", "Weekly"]] as const) {
    const window = limit[key];
    if (!window) continue;
    const resetsAt =
      typeof window.reset_at === "number" ? window.reset_at * 1000 : typeof window.reset_after_seconds === "number" ? Date.now() + window.reset_after_seconds * 1000 : undefined;
    windows.push({
      label: window.limit_window_seconds ? windowLabel(window.limit_window_seconds, label) : label,
      usedPercent: Number(window.used_percent) || 0,
      resetsAt,
      windowMs: typeof window.limit_window_seconds === "number" ? window.limit_window_seconds * 1000 : undefined,
    });
  }
  return windows;
}

async function claude(credential: OAuth): Promise<LimitWindow[]> {
  const body = await getJson("https://api.anthropic.com/api/oauth/usage", {
    Authorization: `Bearer ${credential.access}`,
    "anthropic-beta": "oauth-2025-04-20",
    "User-Agent": "kuru-code",
  });
  const labels: Record<string, [string, number]> = {
    five_hour: ["Session", 5 * 3_600_000],
    seven_day: ["Weekly", 7 * 86_400_000],
    seven_day_opus: ["Opus · Weekly", 7 * 86_400_000],
    seven_day_sonnet: ["Sonnet · Weekly", 7 * 86_400_000],
  };
  const windows: LimitWindow[] = [];
  for (const [key, [label, windowMs]] of Object.entries(labels)) {
    const window = body[key];
    if (!window || typeof window.utilization !== "number") continue;
    const resetsAt = window.resets_at ? Date.parse(window.resets_at) : undefined;
    windows.push({ label, usedPercent: window.utilization, resetsAt: Number.isFinite(resetsAt) ? resetsAt : undefined, windowMs });
  }
  return windows;
}

function windowLabel(seconds: number, fallback: string): string {
  if (seconds >= 6 * 86_400) return "Weekly";
  if (seconds >= 3_600) return fallback === "Session" ? "Session" : `${Math.round(seconds / 3_600)}-hour`;
  return fallback;
}
