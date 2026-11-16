// kuru code's one environment: this machine. T3 Code connects to several
// servers (environments); its sidebar and pages ask which ones are known and
// connected, so kuru code answers with the local one, always connected.
import { LOCAL_ENVIRONMENT_ID, type EnvironmentId } from "~/contracts";
import { useStore } from "~/state";

/** From T3 Code's connection/presentation.ts; kuru code's one environment is always connected. */
export type EnvironmentConnectionPhase =
  | "available"
  | "offline"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "error"
  | "unsupported";

/** The part of T3 Code's server config its sidebar reads. */
export interface EnvironmentServerConfig {
  readonly environment: {
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly capabilities: { readonly threadAutoSettleOptOut: boolean };
  };
  /** Where threads with no project run: the home folder. */
  readonly scratchWorkspaceRoot: string | null;
}

const configs = new Map<string, ReadonlyMap<EnvironmentId, EnvironmentServerConfig>>();

function localConfig(home: string): ReadonlyMap<EnvironmentId, EnvironmentServerConfig> {
  let map = configs.get(home);
  if (!map) {
    map = new Map([
      [
        LOCAL_ENVIRONMENT_ID,
        {
          environment: {
            environmentId: LOCAL_ENVIRONMENT_ID,
            label: "This computer",
            capabilities: { threadAutoSettleOptOut: true },
          },
          scratchWorkspaceRoot: home,
        },
      ],
    ]);
    configs.set(home, map);
  }
  return map;
}

const NO_CONFIGS: ReadonlyMap<EnvironmentId, EnvironmentServerConfig> = new Map();

/** The server configs by environment: the local one, once the main process said where home is. */
export function useServerConfigs(): ReadonlyMap<EnvironmentId, EnvironmentServerConfig> {
  const home = useStore((state) => state.app?.home ?? null);
  return home === null ? NO_CONFIGS : localConfig(home);
}

const CONNECTED: readonly EnvironmentId[] = [LOCAL_ENVIRONMENT_ID];

export function useConnectedEnvironmentIds(): readonly EnvironmentId[] {
  return CONNECTED;
}

export function usePrimaryEnvironmentId(): EnvironmentId {
  return LOCAL_ENVIRONMENT_ID;
}
