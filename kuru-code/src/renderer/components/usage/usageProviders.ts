// From T3 Code's components/usage/usageProviders.ts. T3 Code's usage came from its coding
// agents, a fixed list; kuru code's comes from Unharnessed's providers, whichever are set up.
import type { ProviderDriverKind, UsageProviderKind } from "~/contracts";

import { driverKindOfProvider } from "~/kuru/providers";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryServerConfigAtom } from "~/state/server";
import type { UsageMetric } from "./usageShortcuts";

type UsageProviderPresentation = {
  readonly label: string;
  readonly color: string;
  readonly driverKind: ProviderDriverKind;
};

/** T3 Code's colours, by the agent whose icon a provider shows. */
const DRIVER_COLORS: Readonly<Record<string, string>> = {
  codex: "var(--contrast-foreground)",
  claudeAgent: "#d97757",
  grok: "color-mix(in oklab, var(--contrast-foreground) 72%, var(--background))",
  antigravity: "#8c7bd1",
};
const OTHER_COLORS = ["#5b9bbd", "#4d9f8a", "#0866ff", "#8b8b8b", "#c4a35a", "#c75f8f"];

function configuredProviders() {
  return appAtomRegistry.get(primaryServerConfigAtom)?.providers ?? [];
}

export function providerPresentation(provider: UsageProviderKind): UsageProviderPresentation {
  const configured = configuredProviders().find((entry) => entry.instanceId === provider);
  const driverKind = configured?.driver ?? driverKindOfProvider(provider, false);
  let hash = 0;
  for (const char of provider) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return {
    label: configured?.displayName ?? provider,
    color: DRIVER_COLORS[driverKind] ?? OTHER_COLORS[hash % OTHER_COLORS.length]!,
    driverKind,
  };
}

/** The colour of the first of Unharnessed's providers showing this agent's icon. */
export function driverColor(driver: ProviderDriverKind): string | undefined {
  const configured = configuredProviders().find((entry) => entry.driver === driver);
  return configured ? providerPresentation(configured.instanceId).color : DRIVER_COLORS[driver];
}

/** Unharnessed's providers in their order, then any others usage names (since removed). */
export function providerOrder(
  seen: Iterable<UsageProviderKind> = [],
): readonly UsageProviderKind[] {
  const order: UsageProviderKind[] = configuredProviders().map((entry) => entry.instanceId);
  for (const provider of seen) if (!order.includes(provider)) order.push(provider);
  return order;
}

export function providersWithUsage(
  totals: readonly {
    readonly provider: UsageProviderKind;
    readonly costUsd: number;
    readonly totalTokens: number;
  }[],
): readonly UsageProviderKind[] {
  const active = new Set(
    totals
      .filter((entry) => entry.totalTokens > 0 || entry.costUsd > 0)
      .map((entry) => entry.provider),
  );
  return providerOrder(active).filter((provider) => active.has(provider));
}

export function rankProvidersByMetric(
  providers: readonly UsageProviderKind[],
  totals: readonly {
    readonly provider: UsageProviderKind;
    readonly costUsd: number;
    readonly totalTokens: number;
  }[],
  metric: UsageMetric,
): readonly UsageProviderKind[] {
  const field = metric === "cost" ? "costUsd" : "totalTokens";
  const value = (provider: UsageProviderKind) =>
    totals.find((entry) => entry.provider === provider)?.[field] ?? 0;
  return providers.toSorted((left, right) => value(right) - value(left));
}
