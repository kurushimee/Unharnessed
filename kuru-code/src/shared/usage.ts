// The Usage page: what the threads cost and used, read from the session
// files, and the subscriptions' usage limits.

export type UsageTotals = {
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Replies counted. */
  replies: number;
};

export type UsageReport = {
  days: number;
  /** Sessions with a reply in the period. */
  sessions: number;
  totals: UsageTotals;
  /** By `provider/model`, the costliest first. */
  models: ({ key: string; provider: string; model: string; sessions: number } & UsageTotals)[];
  /** By provider. */
  providers: ({ provider: string; sessions: number } & UsageTotals)[];
  /** Day by day (local days, `YYYY-MM-DD`), oldest first, every day of the period. */
  daily: ({ day: string } & UsageTotals)[];
};

// The usage limits, in T3 Code's shapes (packages/contracts/src/providerUsageLimits.ts):
// main/limits.ts reads them, kuru/limits.ts gives them to T3 Code's screens.

export type UsageWindow = {
  id: string;
  kind: "session" | "weekly" | "monthly" | "other";
  label: string;
  usedPercent: number;
  resetsAt?: string;
  windowDurationMins?: number;
};
export type ResetCreditOption = { creditId: string; label: string; description: string; availableCount: number; expiresAt?: string };
export type ResetCredits = { availableCount: number; nextExpiresAt?: string; nextCreditId?: string; options?: ResetCreditOption[] };
export type UsageLimits = {
  checkedAt: string;
  windows: UsageWindow[];
  credentialFingerprint?: string;
  resetCredits?: ResetCredits;
  unavailable?: { reason: "unsupported" | "probeFailed"; message?: string };
};
/** One signed-in provider of the agent: its limits and whose they are. */
export type ProviderAccount = { limits: UsageLimits; email?: string; plan?: string; workspaceId?: string };
export type SourceAccount = { id: string; driver: string; email?: string; plan?: string; workspaceId?: string; usageLimits: UsageLimits };
export type SourceSnapshot = { id: string; kind: "cliproxy"; label: string; checkedAt: string; accounts: SourceAccount[]; error?: string };
export type LimitsRead = { providers: Record<string, ProviderAccount>; sources: SourceSnapshot[] };
export type ConsumeInput = { instanceId: string; creditId?: string } | { sourceId: string; accountId: string; creditId: string };
export type ConsumeOutcome = "reset" | "nothingToReset" | "noCredit" | "alreadyRedeemed";
export type ConsumeResult = { outcome: ConsumeOutcome; warning?: string };

