// Adapted from T3 Code's state/environments.ts. kuru code has one
// environment, this computer (kuru/environment.ts); these answer T3 Code's
// questions about environments with it.
import { LOCAL_ENVIRONMENT_ID, type EnvironmentId, type EnvironmentMachineKind } from "~/contracts";
import { isMacPlatform } from "~/lib/utils";
export {
  useConnectedEnvironmentIds,
  usePrimaryEnvironmentId,
  useServerConfigs,
  type EnvironmentServerConfig,
} from "~/kuru/environment";

export interface EnvironmentIdentity {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

const IDENTITIES: readonly EnvironmentIdentity[] = [
  { environmentId: LOCAL_ENVIRONMENT_ID, label: "This computer" },
];

export function useEnvironmentIdentities(): readonly EnvironmentIdentity[] {
  return IDENTITIES;
}

const MACHINES: ReadonlyMap<EnvironmentId, EnvironmentMachineKind> = new Map([
  [
    LOCAL_ENVIRONMENT_ID,
    typeof navigator !== "undefined" && isMacPlatform(navigator.platform) ? "laptop" : "desktop",
  ],
]);

export function useEnvironmentMachines(): ReadonlyMap<EnvironmentId, EnvironmentMachineKind> {
  return MACHINES;
}

export function readPrimaryEnvironmentId(): EnvironmentId {
  return LOCAL_ENVIRONMENT_ID;
}

export function usePullRequestsSupported(): boolean {
  return true;
}

import { useAtomValue } from "@effect/atom-react";
import {
  connectionCatalogDisplayUrl,
  hasRelayRoute,
  type EnvironmentPresentation as BaseEnvironmentPresentation,
} from "~/rt/connection/index";
import { environmentCatalog, environmentPresentations, LOCAL_PREPARED_CONNECTION } from "~/kuru/environment";
import { appAtomRegistry } from "~/rpc/atomRegistry";

// From T3 Code's state/environments.ts.
export interface EnvironmentPresentation extends BaseEnvironmentPresentation {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly displayUrl: string | null;
  readonly relayManaged: boolean;
}

function projectEnvironmentPresentation(
  environmentId: EnvironmentId,
  presentation: BaseEnvironmentPresentation,
): EnvironmentPresentation {
  return {
    ...presentation,
    environmentId,
    label: presentation.entry.target.label,
    displayUrl: connectionCatalogDisplayUrl(presentation.entry),
    relayManaged: hasRelayRoute(presentation.entry),
  };
}

let projected: {
  map: ReadonlyMap<EnvironmentId, BaseEnvironmentPresentation>;
  list: ReadonlyArray<EnvironmentPresentation>;
} | null = null;

export function useEnvironments() {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const networkStatus = useAtomValue(environmentCatalog.networkStatusValueAtom);
  const presentationById = useAtomValue(environmentPresentations.presentationsAtom);
  if (projected?.map !== presentationById) {
    projected = {
      map: presentationById,
      list: [...presentationById.entries()].map(([environmentId, presentation]) =>
        projectEnvironmentPresentation(environmentId, presentation),
      ),
    };
  }
  return { isReady: catalog.isReady, networkStatus, environments: projected.list, presentationById };
}

/** Provider statuses change on every push, so they live apart from the presentations. */
export function useEnvironmentProviders() {
  return useAtomValue(environmentPresentations.providersByEnvironmentAtom);
}

/** The environment's state now, for handlers that should not re-render on every change. */
export function readEnvironment(environmentId: EnvironmentId): EnvironmentPresentation | null {
  const presentation = appAtomRegistry.get(environmentPresentations.presentationsAtom).get(environmentId);
  return presentation ? projectEnvironmentPresentation(environmentId, presentation) : null;
}

export function useEnvironment(environmentId: EnvironmentId | null): EnvironmentPresentation | null {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const presentation = environmentId === null ? undefined : presentations.get(environmentId);
  return environmentId === null || presentation === undefined
    ? null
    : projectEnvironmentPresentation(environmentId, presentation);
}

export function usePrimaryEnvironment(): EnvironmentPresentation | null {
  return useEnvironment(LOCAL_ENVIRONMENT_ID);
}

export function useEnvironmentHttpBaseUrl(environmentId: EnvironmentId | null): string | null {
  return environmentId === LOCAL_ENVIRONMENT_ID ? LOCAL_PREPARED_CONNECTION.httpBaseUrl : null;
}
