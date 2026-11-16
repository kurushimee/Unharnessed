// T3 Code's client-runtime state/connections.ts: the environments catalog's
// shape, which T3 Code's shell atoms read. kuru code's catalog has one
// environment, this machine (kuru/environment.ts).
import type { EnvironmentId } from "~/contracts";
import type { ConnectionCatalogEntry } from "../connection/index";

export type { ConnectionCatalogEntry };

export interface EnvironmentCatalogState {
  readonly isReady: boolean;
  readonly entries: ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>;
}

export function* enabledEnvironmentIds(catalog: EnvironmentCatalogState): Generator<EnvironmentId> {
  for (const [environmentId, entry] of catalog.entries) {
    if (entry.enabled && entry.unsupportedReason === undefined) yield environmentId;
  }
}
