// The subscriptions' usage limits as T3 Code's: the main process reads them
// (main/limits.ts) with the agent's own sign-ins and the CLIProxyAPI hubs of the
// "Usage providers" setting. Each login's limits become those of the Unharnessed
// provider it belongs to, and the hubs T3 Code's usage-limit sources.
import type { ProviderConsumeResetCreditInput, ProviderConsumeResetCreditResult, UsageLimitSourceSnapshots } from "~/contracts";
import type { ConsumeResult, LimitsRead, ProviderAccount } from "@shared/usage";
import { invoke } from "~/bridge";

import { setUsageLimitsSource } from "./providers";
import { setUsageLimitSources } from "./serverConfig";

let current: ReadonlyMap<string, ProviderAccount> = new Map();
let pending: Promise<void> | null = null;

/** Reads the limits again; a read already under way is the one waited for. */
export function refreshUsageLimits(): Promise<void> {
  pending ??= invoke<LimitsRead>("limits.get")
    .then((read) => {
      current = new Map(Object.entries(read.providers));
      setUsageLimitsSource(() => current);
      setUsageLimitSources(read.sources as unknown as UsageLimitSourceSnapshots);
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** T3 Code's provider.consumeResetCredit: the main process redeems it and reads the limits again. */
export async function consumeResetCredit(input: ProviderConsumeResetCreditInput): Promise<ProviderConsumeResetCreditResult> {
  const result = await invoke<ConsumeResult>("limits.consume", input);
  await refreshUsageLimits();
  return result as ProviderConsumeResetCreditResult;
}
