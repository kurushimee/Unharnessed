// The subscriptions' usage limits as T3 Code's providers' usage limits: the main
// process reads them (main/limits.ts) with the agent's own sign-ins, and each
// becomes the limits of the Unharnessed provider it belongs to.
import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "~/contracts";
import type { LimitWindow, ProviderLimits } from "@shared/usage";
import { invoke } from "~/bridge";

import { setUsageLimitsSource } from "./providers";

function windowKind(window: LimitWindow): ServerProviderUsageWindow["kind"] {
  if (window.label === "Session") return "session";
  if (window.label.endsWith("Weekly")) return "weekly";
  return "other";
}

function windowId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "window";
}

function toUsageLimits(limits: ProviderLimits, checkedAt: string): ServerProviderUsageLimits {
  return {
    checkedAt,
    windows: limits.windows.map((window) => ({
      id: windowId(window.label),
      kind: windowKind(window),
      label: window.label,
      usedPercent: Math.min(100, Math.max(0, window.usedPercent)),
      ...(window.resetsAt === undefined ? {} : { resetsAt: new Date(window.resetsAt).toISOString() }),
      ...(window.windowMs === undefined ? {} : { windowDurationMins: Math.round(window.windowMs / 60_000) }),
    })),
    ...(limits.error === undefined ? {} : { unavailable: { reason: "probeFailed" as const, message: limits.error } }),
  };
}

let current: ReadonlyMap<string, ServerProviderUsageLimits> = new Map();
let pending: Promise<void> | null = null;

/** Reads the limits again; a read already under way is the one waited for. */
export function refreshUsageLimits(): Promise<void> {
  pending ??= invoke<ProviderLimits[]>("limits.get")
    .then((read) => {
      const checkedAt = new Date().toISOString();
      current = new Map(read.map((limits) => [limits.provider, toUsageLimits(limits, checkedAt)]));
      setUsageLimitsSource(() => current);
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
