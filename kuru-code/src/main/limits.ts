// The subscriptions' usage limits and reset credits, as T3 Code reads them, for
// the Usage page's Limits, the thread details and the providers: T3 Code's
// readers (apps/server/src/provider/codexUsageLimits.ts, claudeUsageLimits.ts,
// claudeResetCredits.ts, antigravityUsageLimits.ts, packages/provider-grok
// usageLimits.ts, apps/server/src/usage/cliproxyApi.ts) on the agent's own
// sign-ins: the agent hands over each login's current token
// (`_unharnessed/auth/fresh`, refreshed as its model requests refresh it), and
// the CLIProxyAPI hubs of the "Usage providers" setting.
import { createHash, randomUUID } from "node:crypto";
import type { LogOutputChannel } from "vscode";

import type {
  ConsumeInput,
  ConsumeOutcome,
  ConsumeResult,
  LimitsRead,
  ProviderAccount,
  ResetCreditOption,
  ResetCredits,
  SourceAccount,
  SourceSnapshot,
  UsageLimits,
  UsageWindow,
} from "@shared/usage";

type Credential = { access: string; expires: number; accountId?: string | null };
type Request = (method: string, params: Record<string, unknown>) => Promise<unknown>;
type SourceConfig = { kind?: unknown; label?: unknown; url?: unknown; managementKey?: unknown; enabled?: unknown };

const SESSION_MINS = 5 * 60;
const WEEK_MINS = 7 * 24 * 60;
const MONTH_MINS = 30 * 24 * 60;
const KIND_ORDER = { session: 0, weekly: 1, monthly: 2, other: 3 } as const;

/** An error whose text the page shows; nothing of a response body, which can hold credentials. */
class LimitsError extends Error {}

const clampPercent = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0);

function makeLimits(checkedAt: string, windows: Iterable<UsageWindow>): UsageLimits {
  return {
    checkedAt,
    windows: [...windows].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id)),
  };
}

function unavailable(checkedAt: string, reason: "unsupported" | "probeFailed", message?: string): UsageLimits {
  return { checkedAt, windows: [], unavailable: { reason, ...(message ? { message } : {}) } };
}

function isoFromSeconds(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : undefined;
}

function isoFromString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
}

const record = (value: unknown): Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, any>) : {};

/** The claims of a JWT access token, unverified: what it says of its account. */
function jwtClaims(token: string): Record<string, any> {
  try {
    return record(JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")));
  } catch {
    return {};
  }
}

async function http(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number; form?: boolean } = {},
): Promise<Response> {
  const headers = { ...init.headers };
  let body: string | undefined;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers["Content-Type"] ??= "application/json";
  }
  try {
    return await fetch(url, {
      method: init.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: "manual",
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new LimitsError(timedOut ? "The request timed out." : `The request failed (${nodeErrorCode(error) ?? "network error"}).`);
  }
}

async function json(response: Response): Promise<Record<string, any>> {
  if (!response.ok) throw new LimitsError(`HTTP ${response.status}`);
  try {
    return record(await response.json());
  } catch {
    throw new LimitsError("The answer was not JSON.");
  }
}

// fetch wraps Node error codes in generic TypeErrors.
function nodeErrorCode(cause: unknown): string | undefined {
  for (let error = cause, depth = 0; error instanceof Error && depth < 3; depth += 1) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code)) return code;
    error = (error as { cause?: unknown }).cause;
  }
  return undefined;
}

// ---- Codex (ChatGPT): codexUsageLimits.ts, CodexProvider.ts codexPlanLabel, cliproxyApi.ts CODEX_HUB.

const CODEX_BASE = "https://chatgpt.com/backend-api/wham";
const CREDIT_URL = `${CODEX_BASE}/rate-limit-reset-credits`;
const CREDIT_REDEEM_NAMESPACE = Buffer.from([
  0x6f, 0x1c, 0x2a, 0x9e, 0x2d, 0x4b, 0x4c, 0x1e, 0x9a, 0x7f, 0x3b, 0x8d, 0x5e, 0x0c, 0x1a, 0x42,
]);

/** UUIDv5 per account and credit, so a retry redeems the same credit once. */
function creditRedeemRequestId(accountId: string, creditId: string): string {
  const bytes = createHash("sha1")
    .update(Buffer.concat([CREDIT_REDEEM_NAMESPACE, Buffer.from(`${accountId}:${creditId}`, "utf8")]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function codexPlanLabel(planType: string | null | undefined): string | undefined {
  switch (planType) {
    case "free":
      return "ChatGPT Free Subscription";
    case "go":
      return "ChatGPT Go Subscription";
    case "plus":
      return "ChatGPT Plus Subscription";
    case "pro":
      return "ChatGPT Pro 200 Subscription";
    case "prolite":
      return "ChatGPT Pro 100 Subscription";
    case "promax":
      return "ChatGPT Pro 500 Subscription";
    case "self_serve_business_prolite":
      return "ChatGPT Business Premium Subscription";
    case "team":
    case "self_serve_business_usage_based":
    case "business":
      return "ChatGPT Business Subscription";
    case "ent26":
    case "enterprise_cbp_automation":
    case "enterprise_cbp_usage_based":
    case "enterprise":
      return "ChatGPT Enterprise Subscription";
    case "edu":
      return "ChatGPT Edu Subscription";
    default:
      return undefined;
  }
}

/** primary/secondary are positions; without a window length, paid plans use 5-hour/weekly windows and Free/Go monthly. */
function codexWindows(usage: Record<string, any>, planType: string | undefined): UsageWindow[] {
  const limit = record(usage.rate_limit);
  const monthlyPlan = planType === "free" || planType === "go";
  const windows: UsageWindow[] = [];
  for (const [id, raw, fallbackMins] of [
    ["primary", limit.primary_window, monthlyPlan ? MONTH_MINS : SESSION_MINS],
    ["secondary", limit.secondary_window, WEEK_MINS],
  ] as const) {
    const window = record(raw);
    if (typeof window.used_percent !== "number" || !Number.isFinite(window.used_percent)) continue;
    const windowDurationMins =
      typeof window.limit_window_seconds === "number" ? Math.round(window.limit_window_seconds / 60) : fallbackMins;
    const kind = windowDurationMins >= MONTH_MINS ? "monthly" : windowDurationMins >= WEEK_MINS ? "weekly" : "session";
    const resetsAt = isoFromSeconds(window.reset_at);
    windows.push({
      id,
      kind,
      label: kind === "session" ? "Session" : kind === "weekly" ? "Weekly" : "Monthly",
      usedPercent: clampPercent(window.used_percent),
      windowDurationMins,
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  return windows;
}

type CodexCall = (url: string, data?: unknown) => Promise<string>;

async function codexCredits(call: CodexCall): Promise<{ id: string; expires_at: string }[]> {
  const list = record(JSON.parse(await call(CREDIT_URL)));
  const now = Date.now();
  return (Array.isArray(list.credits) ? list.credits : [])
    .map(record)
    .filter(
      (credit) =>
        typeof credit.id === "string" &&
        credit.reset_type === "codex_rate_limits" &&
        credit.status === "available" &&
        Date.parse(String(credit.expires_at)) > now,
    )
    .sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at)) as { id: string; expires_at: string }[];
}

async function readCodex(call: CodexCall, planHint: string | undefined, checkedAt: string) {
  const usage = record(JSON.parse(await call(`${CODEX_BASE}/usage`)));
  const planType = typeof usage.plan_type === "string" ? usage.plan_type : planHint;
  const available = await codexCredits(call).catch(() => undefined);
  const next = available?.[0];
  const limits = makeLimits(checkedAt, codexWindows(usage, planType));
  if (available) {
    limits.resetCredits = {
      availableCount: available.length,
      ...(next ? { nextCreditId: next.id, nextExpiresAt: new Date(next.expires_at).toISOString() } : {}),
    };
  }
  return { limits, plan: codexPlanLabel(planType) };
}

function codexHeaders(token: string, accountId: string | undefined): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "codex-1",
    Originator: "Codex Desktop",
    ...(accountId ? { "Chatgpt-Account-Id": accountId } : {}),
  };
}

const CODEX_OUTCOMES: Record<string, ConsumeOutcome> = {
  reset: "reset",
  nothing_to_reset: "nothingToReset",
  no_credit: "noCredit",
  already_redeemed: "alreadyRedeemed",
};

async function consumeCodex(call: CodexCall, accountId: string, creditId: string): Promise<ConsumeOutcome> {
  const body = record(
    JSON.parse(await call(`${CREDIT_URL}/consume`, { redeem_request_id: creditRedeemRequestId(accountId, creditId), credit_id: creditId })),
  );
  const outcome = CODEX_OUTCOMES[String(body.code)];
  if (!outcome) throw new LimitsError("Codex returned an unexpected reset-credit response.");
  return outcome;
}

// ---- Claude: claudeUsageLimits.ts, claudeResetCredits.ts, cliproxyApi.ts's claude hub.

const ANTHROPIC = "https://api.anthropic.com";
const CLAUDE_VERSION = "2.1.273";
const PROGRAM = "cedar_ember";
const GRANT_ID = /^[a-z0-9_-]{1,40}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const COMPLETE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const percentFromAmounts = (used: unknown, limit: unknown) =>
  typeof used === "number" && typeof limit === "number" && Number.isFinite(used) && Number.isFinite(limit) && used >= 0 && limit > 0
    ? clampPercent((used / limit) * 100)
    : undefined;

function claudeSpendPercent(usage: Record<string, any>): number | undefined {
  const spend = record(usage.spend);
  const used = record(spend.used);
  const limit = record(spend.limit);
  // Minor-unit ratios need the same currency and scale; spend.percent is rounded.
  if (
    spend.enabled === true &&
    typeof used.currency === "string" &&
    used.currency.trim() &&
    used.currency.trim() === String(limit.currency ?? "").trim() &&
    used.exponent === limit.exponent
  ) {
    const percent = percentFromAmounts(used.amount_minor, limit.amount_minor);
    if (percent !== undefined) return percent;
  }
  const extra = record(usage.extra_usage);
  if (extra.is_enabled !== true) return undefined;
  const percent = percentFromAmounts(extra.used_credits, extra.monthly_limit) ?? extra.utilization;
  return typeof percent === "number" && Number.isFinite(percent) && percent >= 0 ? clampPercent(percent) : undefined;
}

/** `/api/oauth/usage`, percentages 0-100, as T3 Code's claude hub reads it. */
function claudeUsageToLimits(usage: Record<string, any>, checkedAt: string): UsageLimits {
  const windows: UsageWindow[] = [];
  for (const [id, kind, label, windowDurationMins] of [
    ["five_hour", "session", "Session", SESSION_MINS],
    ["seven_day", "weekly", "Weekly", WEEK_MINS],
  ] as const) {
    const window = record(usage[id]);
    if (typeof window.utilization !== "number") continue;
    const resetsAt = isoFromString(window.resets_at);
    windows.push({ id, kind, label, windowDurationMins, usedPercent: clampPercent(window.utilization), ...(resetsAt ? { resetsAt } : {}) });
  }
  for (const limit of (Array.isArray(usage.limits) ? usage.limits : []).map(record)) {
    const name = record(record(limit.scope).model).display_name;
    if (limit.kind !== "weekly_scoped" || typeof name !== "string" || typeof limit.percent !== "number") continue;
    const resetsAt = isoFromString(limit.resets_at);
    windows.push({
      id: `seven_day_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      kind: "weekly",
      label: `Weekly · ${name}`,
      windowDurationMins: WEEK_MINS,
      usedPercent: clampPercent(limit.percent),
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  const spendPercent = claudeSpendPercent(usage);
  if (spendPercent !== undefined) windows.push({ id: "monthly_spend", kind: "monthly", label: "Monthly spend", usedPercent: spendPercent });
  return makeLimits(checkedAt, windows);
}

// Claude Code's own grouping: a grant that gives back weekly usage is a Fable reset, else its type, else what it clears.
const RESET_KINDS = {
  session: { label: "5-hour reset", description: "Refills your 5-hour limit." },
  weekly: { label: "Weekly reset", description: "Refills your weekly limit." },
  fable: {
    label: "Fable reset",
    description:
      "Refills your Fable allowance and gives back what Fable used on your weekly limit. It doesn't reset your whole week.",
  },
  full: { label: "Full reset", description: "Refills your 5-hour and weekly limits." },
} as const;
type ResetKind = keyof typeof RESET_KINDS;

function isFutureTimestamp(value: string, nowMs: number): boolean {
  if (!COMPLETE_TIMESTAMP.test(value)) return false;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return Date.parse(value) > nowMs && Date.UTC(year!, month! - 1, day!) <= Date.UTC(year!, month!, 0);
}

function grantKind(grant: Record<string, any>): ResetKind {
  if (grant.gives_back_weekly) return "fable";
  if (grant.type === "session" || grant.type === "weekly" || grant.type === "full") return grant.type;
  const clears: unknown[] = Array.isArray(grant.clears) ? grant.clears : [];
  const session = clears.includes("five_hour");
  const other = clears.some((limit) => limit !== "five_hour");
  return session && !other ? "session" : other && !session ? "weekly" : "full";
}

/** The `cedar_ember` block of `/api/oauth/usage?cedar_ember=1`: claudeResetCreditsToContract. */
function claudeResetCredits(block: unknown, nowMs: number): ResetCredits | undefined {
  const parsed = record(block);
  if (parsed.eligible !== true) return undefined;
  const live = (Array.isArray(parsed.grants) ? parsed.grants : [])
    .map(record)
    .filter(
      (grant) =>
        typeof grant.id === "string" &&
        GRANT_ID.test(grant.id) &&
        Number.isInteger(grant.resets_left) &&
        grant.resets_left >= 0 &&
        !grant.paused &&
        grant.usable_now &&
        (grant.ends_at == null || (typeof grant.ends_at === "string" && isFutureTimestamp(grant.ends_at, nowMs))),
    );
  const next = live.find((grant) => grant.id === parsed.next_grant_id);
  const expiresAt = (grant: Record<string, any> | undefined) => (grant?.ends_at ? isoFromString(grant.ends_at) : undefined);
  const byKind = new Map<ResetKind, Record<string, any>[]>();
  for (const grant of live) {
    if (grant.resets_left === 0) continue;
    const kind = grantKind(grant);
    byKind.set(kind, [...(byKind.get(kind) ?? []), grant]);
  }
  const options = (Object.keys(RESET_KINDS) as ResetKind[]).flatMap((kind): ResetCreditOption[] => {
    const grants = byKind.get(kind);
    const target = grants?.[0];
    if (!grants || !target) return [];
    const optionExpiresAt = expiresAt(target);
    return [
      {
        creditId: target.id,
        ...RESET_KINDS[kind],
        availableCount: grants.reduce((sum, grant) => sum + grant.resets_left, 0),
        ...(optionExpiresAt ? { expiresAt: optionExpiresAt } : {}),
      },
    ];
  });
  const nextExpiresAt = expiresAt(next);
  return {
    availableCount: next ? live.reduce((sum, grant) => sum + grant.resets_left, 0) : 0,
    ...(nextExpiresAt ? { nextExpiresAt } : {}),
    ...(next ? { nextCreditId: next.id, options } : {}),
  };
}

const claudeHeaders = (token: string, userAgent: string) => ({
  Authorization: `Bearer ${token}`,
  "anthropic-beta": "oauth-2025-04-20",
  "User-Agent": userAgent,
});

const CLAUDE_PLANS: Record<string, string> = {
  claude_pro: "Claude Pro Subscription",
  claude_max: "Claude Max Subscription",
  claude_team: "Claude Team Subscription",
  claude_enterprise: "Claude Enterprise Subscription",
};

const RESET_FAILURES = {
  malformedCredit: "Claude returned a malformed reset credit.",
  signedOut: "Sign in to Claude again to redeem resets.",
  rateLimited: "Claude is rate limiting resets. Try again soon.",
  coolingDown: "Claude resets are cooling down. Try again later.",
  unconfirmed: "Claude could not confirm the reset. If you are still limited in a moment, try again.",
  requestFailed: "Claude could not redeem the reset.",
} as const;

/** A claim failure whose request id may be used again (the claim may not have landed). */
class UnsettledClaim extends LimitsError {}

const CLAIM_OUTCOMES: Record<string, ConsumeOutcome> = {
  reset: "reset",
  not_limited: "nothingToReset",
  already_used: "alreadyRedeemed",
  ineligible: "noCredit",
};

// ---- Grok: packages/provider-grok/src/server/usageLimits.ts.

const GROK_USAGE_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const GROK_CLI_VERSION = "1.0.77";
const grokHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "x-xai-token-auth": "xai-grok-cli",
  "x-grok-client-version": GROK_CLI_VERSION,
  "User-Agent": `grok-cli/${GROK_CLI_VERSION}`,
});

function grokUsageToLimits(response: Record<string, any>, checkedAt: string): UsageLimits {
  const config = record(response.config);
  const period = record(config.currentPeriod);
  const periodType = typeof period.type === "string" ? period.type.replace(/^USAGE_PERIOD_TYPE_/, "") : undefined;
  const kind = periodType === "WEEKLY" ? "weekly" : periodType === "MONTHLY" ? "monthly" : "other";
  let usedPercent: unknown = config.creditUsagePercent;
  // Grok omits a zero percentage while it keeps the whole subscription period.
  if (
    usedPercent === undefined &&
    (kind === "weekly" || kind === "monthly") &&
    typeof period.start === "string" &&
    Date.parse(period.start) < Date.parse(String(period.end))
  ) {
    usedPercent = 0;
  }
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) return makeLimits(checkedAt, []);
  const resetsAt = isoFromString(period.end);
  return makeLimits(checkedAt, [
    {
      id: "subscription",
      kind,
      label: kind === "weekly" ? "Weekly" : kind === "monthly" ? "Monthly" : "Subscription",
      usedPercent: clampPercent(usedPercent),
      ...(resetsAt ? { resetsAt } : {}),
    },
  ]);
}

// ---- Antigravity: antigravityUsageLimits.ts.

const ANTIGRAVITY_DAILY = "https://daily-cloudcode-pa.googleapis.com";
const ANTIGRAVITY_PROD = "https://cloudcode-pa.googleapis.com";
const SUMMARY_WINDOW_MINS = new Map([
  ["5h", SESSION_MINS],
  ["weekly", WEEK_MINS],
]);
const antigravityUserAgent = () =>
  `antigravity/hub/2.24.0 (aidev_client; os_type=${process.platform}; arch=${process.arch}; cl=963137146)`;

function quotaWindow(
  id: string,
  label: string,
  quota: Record<string, any>,
  kind: UsageWindow["kind"] = "other",
  windowDurationMins?: number,
): UsageWindow | undefined {
  if (typeof quota.remainingFraction !== "number" || !Number.isFinite(quota.remainingFraction)) return undefined;
  const resetsAt = isoFromString(quota.resetTime);
  return {
    id,
    label,
    kind,
    usedPercent: (1 - Math.max(0, Math.min(1, quota.remainingFraction))) * 100,
    ...(resetsAt ? { resetsAt } : {}),
    ...(windowDurationMins === undefined ? {} : { windowDurationMins }),
  };
}

/** Windows from a `retrieveUserQuotaSummary` answer requested at `requestedAt`. */
function antigravitySummaryWindows(summary: Record<string, any>, requestedAt: number): UsageWindow[] {
  const windows = new Map<string, UsageWindow>();
  const groupsRaw = (Array.isArray(summary.groups) ? summary.groups : []).map(record);
  const groups = groupsRaw.some((group) => Array.isArray(group.buckets) && group.buckets.length)
    ? groupsRaw
    : [{ buckets: summary.buckets }];
  for (const group of groups) {
    for (const bucket of (Array.isArray(group.buckets) ? group.buckets : []).map(record)) {
      if (bucket.disabled || typeof bucket.bucketId !== "string" || !bucket.bucketId) continue;
      const groupName = typeof group.displayName === "string" ? group.displayName.trim() : "";
      // Argon and Carbon are metered apart from the default Gemini buckets.
      const family = bucket.bucketId.startsWith("gemini-argon-")
        ? groupName || "Gemini Argon"
        : bucket.bucketId.startsWith("gemini-carbon-")
          ? groupName || "Gemini Carbon"
          : bucket.bucketId.startsWith("gemini-")
            ? "Gemini"
            : bucket.bucketId.startsWith("3p-")
              ? "Claude & GPT (shared)"
              : groupName || bucket.bucketId;
      const weekly = bucket.window === "weekly";
      const session = bucket.window === "5h";
      const windowDurationMins = SUMMARY_WINDOW_MINS.get(String(bucket.window ?? ""));
      // Untouched summary buckets report a rolling full-window reset.
      const untouched =
        bucket.remainingFraction === 1 &&
        bucket.description === undefined &&
        windowDurationMins !== undefined &&
        Math.abs(Date.parse(String(bucket.resetTime ?? "")) - requestedAt - windowDurationMins * 60_000) <= 60_000;
      const name = typeof bucket.displayName === "string" ? bucket.displayName.trim() : "";
      const window = quotaWindow(
        bucket.bucketId,
        `${family} · ${weekly ? "Weekly" : session ? "5-hour" : name || "Quota"}`,
        { ...bucket, resetTime: untouched ? undefined : bucket.resetTime },
        weekly ? "weekly" : session ? "session" : "other",
        windowDurationMins,
      );
      if (window) windows.set(window.id, window);
    }
  }
  return [...windows.values()];
}

/** Older accounts give model quotas without a window length; no reset cadence is made up for them. */
function antigravityModelWindows(answer: Record<string, any>): UsageWindow[] {
  const windows = new Map<string, UsageWindow>();
  for (const [modelId, raw] of Object.entries(record(answer.models))) {
    const model = record(raw);
    const family =
      model.modelProvider === "MODEL_PROVIDER_GOOGLE" || modelId.startsWith("gemini-")
        ? "Gemini"
        : model.modelProvider === "MODEL_PROVIDER_ANTHROPIC" || modelId.startsWith("claude-")
          ? "Claude"
          : model.modelProvider === "MODEL_PROVIDER_OPENAI" || modelId.startsWith("gpt-")
            ? "GPT"
            : undefined;
    if (!family) continue;
    for (const [suffix, quota] of [
      ["quota", model.quotaInfo],
      ["weekly", model.weeklyQuotaInfo],
    ] as const) {
      if (!quota) continue;
      const window = quotaWindow(
        `${family.toLowerCase()}-${suffix}`,
        `${family} · ${suffix === "weekly" ? "Weekly" : "Reported quota"}`,
        record(quota),
        suffix === "weekly" ? "weekly" : "other",
        suffix === "weekly" ? WEEK_MINS : undefined,
      );
      if (!window) continue;
      const previous = windows.get(window.id);
      if (!previous || window.usedPercent > previous.usedPercent) windows.set(window.id, window);
    }
  }
  return [...windows.values()];
}

/** Keys an account by its Google id, which is the same on every machine and hub. */
const antigravityFingerprint = (userInfo: Record<string, any>) =>
  typeof userInfo.id === "string" && userInfo.id
    ? createHash("sha256").update(`google-account\0${userInfo.id}`).digest("hex")
    : undefined;

// ---- CLIProxyAPI hubs: cliproxyApi.ts.

type Hub = { url: string; managementKey: string };
type AuthFile = {
  id: string;
  auth_index: string;
  provider: string;
  email?: string;
  disabled?: boolean;
  project_id?: string;
  id_token?: { chatgpt_account_id?: string; chatgpt_plan_type?: string; plan_type?: string };
};

const UNTRUSTED_CERTIFICATE_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/** A management call: the hub's answer, or the kind of failure (its responses can hold credentials). */
async function management(hub: Hub, path: string, body?: unknown): Promise<Record<string, any>> {
  let url: string;
  try {
    const base = new URL(hub.url);
    // The hub's web panel URL, often pasted, ends in management.html.
    base.pathname = base.pathname.replace(/(\/management\.html)?\/?$/i, "/");
    url = new URL(`v0/management/${path}`, base).toString();
  } catch {
    throw new LimitsError("The hub URL is not valid.");
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${hub.managementKey}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new LimitsError("The hub did not answer within 15 seconds.");
    const code = nodeErrorCode(error);
    if (code !== undefined && UNTRUSTED_CERTIFICATE_CODES.has(code)) {
      throw new LimitsError(
        `The hub's TLS certificate is not trusted (${code}). If it comes from a private CA, add that CA to NODE_EXTRA_CA_CERTS.`,
      );
    }
    throw new LimitsError(code !== undefined ? `The hub request failed (${code}).` : "The hub management request failed.");
  }
  if (!response.ok) throw new LimitsError(`The hub answered with HTTP ${response.status}.`);
  try {
    return record(await response.json());
  } catch {
    throw new LimitsError("The hub management request failed.");
  }
}

async function authFiles(hub: Hub): Promise<AuthFile[]> {
  const answer = await management(hub, "auth-files");
  return (Array.isArray(answer.files) ? answer.files : [])
    .map(record)
    .filter((file) => typeof file.id === "string" && typeof file.auth_index === "string" && typeof file.provider === "string") as AuthFile[];
}

/** One upstream request with the account's token: the hub puts it in for `$TOKEN$`. */
async function apiCall(hub: Hub, account: AuthFile, header: Record<string, string>, url: string, data?: unknown): Promise<string> {
  const answer = await management(hub, "api-call", {
    auth_index: account.auth_index,
    method: data === undefined ? "GET" : "POST",
    url,
    header,
    ...(data === undefined ? {} : { data: JSON.stringify(data) }),
  });
  if (typeof answer.status_code !== "number" || typeof answer.body !== "string") {
    throw new LimitsError("The hub returned an unexpected answer.");
  }
  if (answer.status_code < 200 || answer.status_code >= 300) {
    throw new LimitsError(`The provider refused the hub request (HTTP ${answer.status_code}).`);
  }
  return answer.body;
}

const listedIdentity = (account: AuthFile) => ({
  ...(account.email ? { email: account.email } : {}),
  ...(account.id_token?.chatgpt_account_id?.trim() ? { workspaceId: account.id_token.chatgpt_account_id.trim() } : {}),
});

const HUB_DRIVERS: Record<string, string> = { codex: "codex", claude: "claudeAgent", xai: "grok", antigravity: "antigravity" };

async function readHubAccount(hub: Hub, account: AuthFile): Promise<SourceAccount> {
  const checkedAt = new Date().toISOString();
  const driver = HUB_DRIVERS[account.provider]!;
  const call = (header: Record<string, string>) => (url: string, data?: unknown) => apiCall(hub, account, header, url, data);
  try {
    switch (account.provider) {
      case "codex": {
        const header = { ...codexHeaders("$TOKEN$", account.id_token?.chatgpt_account_id), Authorization: "Bearer $TOKEN$" };
        const read = await readCodex(call(header), account.id_token?.plan_type ?? account.id_token?.chatgpt_plan_type, checkedAt);
        return { id: account.id, driver, ...listedIdentity(account), ...(read.plan ? { plan: read.plan } : {}), usageLimits: read.limits };
      }
      case "claude": {
        const usage = record(JSON.parse(await call(claudeHeaders("$TOKEN$", "claude-code/2.1.273"))(`${ANTHROPIC}/api/oauth/usage`)));
        return { id: account.id, driver, ...listedIdentity(account), plan: "Claude Subscription", usageLimits: claudeUsageToLimits(usage, checkedAt) };
      }
      case "xai": {
        const usage = record(JSON.parse(await call(grokHeaders("$TOKEN$"))(GROK_USAGE_URL)));
        return { id: account.id, driver, ...listedIdentity(account), usageLimits: grokUsageToLimits(usage, checkedAt) };
      }
      default: {
        const project = account.project_id?.trim();
        if (!project) throw new LimitsError("No Antigravity project reported.");
        const header = { Authorization: "Bearer $TOKEN$", "Content-Type": "application/json", "User-Agent": antigravityUserAgent() };
        const requestedAt = Date.now();
        const summary = record(JSON.parse(await call(header)(`${ANTIGRAVITY_DAILY}/v1internal:retrieveUserQuotaSummary`, { project })));
        const windows = antigravitySummaryWindows(summary, requestedAt);
        if (windows.length === 0) throw new LimitsError("No Antigravity quota reported.");
        const usageLimits = makeLimits(checkedAt, windows);
        // Antigravity reports no e-mail; the Google account fingerprint is what pools it with the agent's login.
        const fingerprint = await call(header)("https://www.googleapis.com/oauth2/v2/userinfo")
          .then((body) => antigravityFingerprint(record(JSON.parse(body))))
          .catch(() => undefined);
        return fingerprint
          ? { id: account.id, driver, usageLimits: { ...usageLimits, credentialFingerprint: fingerprint } }
          : { id: account.id, driver, ...listedIdentity(account), usageLimits };
      }
    }
  } catch {
    return {
      id: account.id,
      driver,
      ...listedIdentity(account),
      usageLimits: unavailable(checkedAt, "probeFailed", "The hub could not read this account's usage."),
    };
  }
}

function sourceLabel(id: string, config: SourceConfig): string {
  if (typeof config.label === "string" && config.label.trim()) return config.label.trim();
  const fallback = id.trim() || "Usage limit source";
  try {
    return new URL(String(config.url)).host || fallback;
  } catch {
    return fallback;
  }
}

// ---- The agent's logins.

/** Unharnessed's subscription logins T3 Code reads limits for, by the agent's provider id. */
const LOGINS = ["openai-codex", "anthropic", "google-antigravity", "xai"] as const;
type Login = (typeof LOGINS)[number];

export class Limits {
  /** Redemptions run one at a time per account, each keeping its request id until it settles. */
  private readonly redeeming = new Map<string, Promise<unknown>>();
  private readonly pendingClaim = new Map<string, string>();
  /** The last limits read, whose credits a redemption names. */
  private last: LimitsRead = { providers: {}, sources: [] };

  constructor(
    private readonly log: LogOutputChannel,
    private readonly request: Request,
    private readonly settings: () => Record<string, unknown> | null,
  ) {}

  private async credential(provider: Login): Promise<Credential | null> {
    const answer = record(await this.request("_unharnessed/auth/fresh", { provider }));
    const credential = record(answer.credential);
    return typeof credential.access === "string" && credential.access
      ? { access: credential.access, expires: Number(credential.expires) || 0, accountId: credential.accountId ?? null }
      : null;
  }

  async read(): Promise<LimitsRead> {
    const providers: Record<string, ProviderAccount> = {};
    await Promise.all(
      LOGINS.map(async (login) => {
        let credential: Credential | null;
        try {
          credential = await this.credential(login);
        } catch (error) {
          this.log.warn(`limits: ${login}: no token from the agent: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
        if (!credential) return;
        const account = await this.readLogin(login, credential);
        const windows = account.limits.windows.map((window) => `${window.label} ${Math.round(window.usedPercent)}%`);
        this.log.info(`limits: ${login}: ${account.limits.unavailable?.message ?? (windows.join(", ") || "none")}`);
        providers[login] = account;
      }),
    );
    const sources = await this.readSources();
    this.last = { providers, sources };
    return this.last;
  }

  private async readLogin(login: Login, credential: Credential): Promise<ProviderAccount> {
    const checkedAt = new Date().toISOString();
    const token = credential.access;
    try {
      switch (login) {
        case "openai-codex": {
          const claims = jwtClaims(token);
          const auth = record(claims["https://api.openai.com/auth"]);
          const accountId = credential.accountId ?? (typeof auth.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined);
          const email = record(claims["https://api.openai.com/profile"]).email;
          const call: CodexCall = async (url, data) => {
            const response = await http(url, { headers: codexHeaders(token, accountId ?? undefined), ...(data === undefined ? {} : { body: data }) });
            if (!response.ok) throw new LimitsError(`ChatGPT answered with HTTP ${response.status}.`);
            return response.text();
          };
          const planHint = typeof auth.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type : undefined;
          const read = await readCodex(call, planHint, checkedAt);
          return {
            limits: read.limits,
            ...(typeof email === "string" && email ? { email } : {}),
            ...(read.plan ? { plan: read.plan } : {}),
            ...(accountId ? { workspaceId: accountId } : {}),
          };
        }
        case "anthropic": {
          const [usage, credits, profile] = await Promise.all([
            http(`${ANTHROPIC}/api/oauth/usage`, { headers: claudeHeaders(token, `claude-code/${CLAUDE_VERSION}`) }).then(json),
            http(`${ANTHROPIC}/api/oauth/usage?cedar_ember=1&skip_spend=1`, {
              headers: claudeHeaders(token, `claude-cli/${CLAUDE_VERSION} (external, cli)`),
              timeoutMs: 10_000,
            })
              .then(json)
              .catch(() => undefined),
            this.claudeProfile(token).catch(() => undefined),
          ]);
          const limits = claudeUsageToLimits(usage, checkedAt);
          const resetCredits = credits ? claudeResetCredits(credits.cedar_ember, Date.now()) : undefined;
          if (resetCredits) limits.resetCredits = resetCredits;
          const account = record(profile?.account);
          const email = account.email ?? account.email_address;
          const plan = CLAUDE_PLANS[String(record(profile?.organization).organization_type)];
          return { limits, ...(typeof email === "string" && email ? { email } : {}), ...(plan ? { plan } : {}) };
        }
        case "xai": {
          const response = await http(GROK_USAGE_URL, { headers: grokHeaders(token), timeoutMs: 10_000 });
          const email = jwtClaims(token).email;
          const identity = typeof email === "string" && email ? { email } : {};
          if (response.status === 403) {
            const error = await response.json().then((body) => String(record(body).error ?? ""), () => "");
            // xAI refuses Grok Build while the account's privacy setting is a legacy mode.
            if (error.includes("WKE=privacy-mode:")) {
              return { ...identity, limits: unavailable(checkedAt, "probeFailed", "Switch your xAI account to Privacy Mode to show Grok usage limits.") };
            }
          }
          return { ...identity, limits: grokUsageToLimits(await json(response), checkedAt) };
        }
        case "google-antigravity": {
          const project = credential.accountId ?? undefined;
          const headers = { Authorization: `Bearer ${token}`, "User-Agent": antigravityUserAgent() };
          // The two hosts meter different tiers; the first host's reading of a bucket wins.
          const fetchWindows = async (operation: string, parse: (answer: Record<string, any>, requestedAt: number) => UsageWindow[]) => {
            const readings = await Promise.all(
              [ANTIGRAVITY_DAILY, ANTIGRAVITY_PROD].map(async (endpoint) => {
                const requestedAt = Date.now();
                try {
                  const answer = await http(`${endpoint}/v1internal:${operation}`, {
                    headers,
                    body: project ? { project } : {},
                    timeoutMs: 10_000,
                  }).then(json);
                  return parse(answer, requestedAt);
                } catch {
                  return [];
                }
              }),
            );
            const windows = new Map<string, UsageWindow>();
            for (const window of readings.flat()) if (!windows.has(window.id)) windows.set(window.id, window);
            return [...windows.values()];
          };
          const summary = await fetchWindows("retrieveUserQuotaSummary", antigravitySummaryWindows);
          const windows = summary.length ? summary : await fetchWindows("fetchAvailableModels", antigravityModelWindows);
          if (windows.length === 0) return { limits: unavailable(checkedAt, "probeFailed", "Antigravity did not return usable quota information.") };
          const userInfo = await http("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 10_000 })
            .then(json)
            .catch(() => ({}) as Record<string, any>);
          const fingerprint = antigravityFingerprint(userInfo);
          return {
            limits: { ...makeLimits(checkedAt, windows), ...(fingerprint ? { credentialFingerprint: fingerprint } : {}) },
            ...(typeof userInfo.email === "string" && userInfo.email ? { email: userInfo.email } : {}),
          };
        }
      }
    } catch (error) {
      const message = error instanceof LimitsError ? error.message : "The usage request failed.";
      this.log.warn(`limits: ${login}: ${error instanceof Error ? error.message : String(error)}`);
      return { limits: unavailable(checkedAt, "probeFailed", `Could not read usage limits: ${message}`) };
    }
  }

  /** The signed-in Claude account and its organization (Claude Code's `/api/oauth/profile`). */
  private async claudeProfile(token: string): Promise<Record<string, any>> {
    return http(`${ANTHROPIC}/api/oauth/profile`, { headers: claudeHeaders(token, `claude-cli/${CLAUDE_VERSION} (external, cli)`), timeoutMs: 10_000 }).then(json);
  }

  private configuredSources(): [string, SourceConfig][] {
    const sources = record(this.settings()?.usageLimitSources);
    return Object.entries(sources)
      .map(([id, config]) => [id, record(config)] as [string, SourceConfig])
      .filter(([, config]) => config.kind === "cliproxy" && config.enabled !== false && typeof config.url === "string");
  }

  private hubOf(config: SourceConfig): Hub {
    if (typeof config.managementKey !== "string") throw new LimitsError("Could not read the management key from its secret provider.");
    if (!config.managementKey.trim()) throw new LimitsError("No management key configured.");
    return { url: String(config.url), managementKey: config.managementKey.trim() };
  }

  private async readSources(): Promise<SourceSnapshot[]> {
    return Promise.all(
      this.configuredSources().map(async ([id, config]): Promise<SourceSnapshot> => {
        const label = sourceLabel(id, config);
        const checkedAt = new Date().toISOString();
        try {
          const hub = this.hubOf(config);
          const accounts = (await authFiles(hub)).filter((account) => HUB_DRIVERS[account.provider] && !account.disabled);
          const read: SourceAccount[] = [];
          // Four at a time, as T3 Code reads them.
          for (let index = 0; index < accounts.length; index += 4) {
            read.push(...(await Promise.all(accounts.slice(index, index + 4).map((account) => readHubAccount(hub, account)))));
          }
          this.log.info(`limits: hub ${label}: ${read.length} accounts`);
          return { id, kind: "cliproxy", label, checkedAt, accounts: read };
        } catch (error) {
          const message = error instanceof LimitsError ? error.message : "The hub could not list accounts.";
          this.log.warn(`limits: hub ${label}: ${message}`);
          return { id, kind: "cliproxy", label, checkedAt, accounts: [], error: message };
        }
      }),
    );
  }

  /** Redeems a reset credit (T3 Code's provider.consumeResetCredit), then reads the limits again. */
  async consume(input: ConsumeInput): Promise<ConsumeResult> {
    const account = "instanceId" in input ? `login:${input.instanceId}` : `hub:${input.sourceId}:${input.accountId}`;
    const previous = this.redeeming.get(account) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.redeem(input, account));
    this.redeeming.set(account, run);
    try {
      const result = await run;
      this.log.info(`limits: ${account}: reset credit ${result.outcome}${result.warning ? ` (${result.warning})` : ""}`);
      return result;
    } catch (error) {
      this.log.warn(`limits: ${account}: reset credit failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error instanceof LimitsError ? new Error(error.message) : new Error("Could not use the reset credit.");
    } finally {
      if (this.redeeming.get(account) === run) this.redeeming.delete(account);
    }
  }

  private async redeem(input: ConsumeInput, account: string): Promise<ConsumeResult> {
    if ("sourceId" in input) return this.redeemFromHub(input);
    const login = input.instanceId as Login;
    if (login !== "openai-codex" && login !== "anthropic") return { outcome: "noCredit" };
    const credential = await this.credential(login);
    if (!credential) throw new LimitsError(login === "anthropic" ? RESET_FAILURES.signedOut : "Sign in to ChatGPT again to redeem resets.");
    const credits = this.last.providers[login]?.limits.resetCredits;
    let outcome: ConsumeOutcome;
    if (login === "openai-codex") {
      const creditId = input.creditId ?? credits?.nextCreditId;
      if (!creditId) return { outcome: "noCredit" };
      const claims = record(jwtClaims(credential.access)["https://api.openai.com/auth"]);
      const accountId = credential.accountId ?? (typeof claims.chatgpt_account_id === "string" ? claims.chatgpt_account_id : undefined);
      const call: CodexCall = async (url, data) => {
        const response = await http(url, { headers: codexHeaders(credential.access, accountId ?? undefined), body: data, timeoutMs: 20_000 });
        if (!response.ok) throw new LimitsError(`ChatGPT answered with HTTP ${response.status}.`);
        return response.text();
      };
      outcome = await consumeCodex(call, accountId ?? "codex", creditId);
    } else {
      const grantId =
        input.creditId === undefined
          ? credits?.nextCreditId
          : credits?.options?.some((option) => option.creditId === input.creditId)
            ? input.creditId
            : undefined;
      if (!grantId) return { outcome: "noCredit" };
      outcome = await this.claimClaude(account, credential.access, grantId);
    }
    if (outcome === "reset") {
      // The windows just changed: read them again so the page shows it.
      const read = await this.read().catch(() => null);
      const limits = read?.providers[login]?.limits;
      if (!limits || limits.unavailable?.reason === "probeFailed") {
        return { outcome, warning: "The reset was applied, but the new limits could not be read. Refresh to check." };
      }
    }
    return { outcome };
  }

  /** consumeClaudeResetCredit: the request id is the claim's idempotency key, kept until the claim settles. */
  private async claimClaude(account: string, token: string, grantId: string): Promise<ConsumeOutcome> {
    const requestId = this.pendingClaim.get(account) ?? randomUUID();
    if (!GRANT_ID.test(grantId) || !REQUEST_ID.test(requestId)) throw new LimitsError(RESET_FAILURES.malformedCredit);
    this.pendingClaim.set(account, requestId);
    try {
      const profile = await this.claudeProfile(token).catch(() => undefined);
      const organization = record(profile?.organization).uuid;
      if (typeof organization !== "string" || !organization.trim()) throw new LimitsError(RESET_FAILURES.signedOut);
      let response: Response;
      try {
        response = await http(`${ANTHROPIC}/api/organizations/${encodeURIComponent(organization.trim())}/reset_rate_limits`, {
          headers: claudeHeaders(token, `claude-cli/${CLAUDE_VERSION} (external, cli)`),
          body: { program: PROGRAM, grant_id: grantId, request_id: requestId },
          timeoutMs: 25_000,
        });
      } catch {
        throw new UnsettledClaim(RESET_FAILURES.requestFailed);
      }
      if (response.status === 429) throw new LimitsError(RESET_FAILURES.rateLimited);
      if (response.status === 401 || response.status === 403) throw new LimitsError(RESET_FAILURES.signedOut);
      const body = await json(response).catch(() => {
        throw new UnsettledClaim(RESET_FAILURES.requestFailed);
      });
      if (body.result === "cooldown") throw new LimitsError(RESET_FAILURES.coolingDown);
      // An unknown outcome keeps the request id, so a retry names the same claim.
      if (body.result === "unavailable") throw new UnsettledClaim(RESET_FAILURES.unconfirmed);
      const outcome = CLAIM_OUTCOMES[String(body.result)];
      if (!outcome) throw new UnsettledClaim(RESET_FAILURES.requestFailed);
      this.pendingClaim.delete(account);
      return outcome;
    } catch (error) {
      if (!(error instanceof UnsettledClaim)) this.pendingClaim.delete(account);
      throw error;
    }
  }

  /** CliproxyApi.consume: a Codex credit through the hub, then the hub's cooldown cleared. */
  private async redeemFromHub(input: { sourceId: string; accountId: string; creditId: string }): Promise<ConsumeResult> {
    const config = this.configuredSources().find(([id]) => id === input.sourceId)?.[1];
    if (!config) throw new LimitsError("The usage limit source is missing or disabled.");
    const hub = this.hubOf(config);
    const account = (await authFiles(hub)).find((file) => file.id === input.accountId);
    if (!account || account.disabled || account.provider !== "codex") {
      throw new LimitsError("The Codex hub account is missing or disabled.");
    }
    const header = { ...codexHeaders("$TOKEN$", account.id_token?.chatgpt_account_id), Authorization: "Bearer $TOKEN$" };
    const outcome = await consumeCodex(
      (url, data) => apiCall(hub, account, header, url, data),
      account.id_token?.chatgpt_account_id ?? account.id,
      input.creditId,
    );
    if (outcome !== "reset" && outcome !== "alreadyRedeemed") return { outcome };
    const cleared = await management(hub, "reset-quota", { auth_index: account.auth_index }).then(
      () => true,
      () => false,
    );
    await this.read().catch(() => null);
    return cleared
      ? { outcome }
      : {
          outcome,
          warning: "Credit redeemed, but the hub cooldown could not be cleared. Routing may resume after its cooldown expires.",
        };
  }
}
