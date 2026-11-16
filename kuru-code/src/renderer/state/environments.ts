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
