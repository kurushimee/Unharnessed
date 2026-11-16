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

export type LimitWindow = {
  label: string;
  /** Percent used, 0 to 100. */
  usedPercent: number;
  /** When it resets, ms; absent when unknown. */
  resetsAt?: number;
  /** How long the window is, ms. */
  windowMs?: number;
};

export type ProviderLimits = {
  provider: string;
  name: string;
  windows: LimitWindow[];
  /** Why they could not be read. */
  error?: string;
};
