// kuru code's one environment: this machine. T3 Code connects to several
// servers (environments) and its screens ask which are known, how they are
// connected, and what their servers are; kuru code answers with its own
// machine, served by its main process, always connected, whose server config
// is kuru/serverConfig.ts's.
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { LOCAL_ENVIRONMENT_ID, type EnvironmentId, type ServerProvider } from "~/contracts";
import type {
  ConnectionCatalogEntry,
  EnvironmentPresentation,
  EnvironmentServerConfig,
  PreparedConnection,
} from "~/rt/connection/index";
import type { EnvironmentCatalogState } from "~/rt/state/connections";
import { LOCAL_ASSET_BASE_URL } from "~/state/session";
import { serverConfigAtom } from "./serverConfig";

export type { EnvironmentConnectionPhase, EnvironmentServerConfig } from "~/rt/connection/index";

export const LOCAL_ENVIRONMENT_LABEL = "This computer";

const LOCAL_ENTRY: ConnectionCatalogEntry = {
  target: {
    _tag: "PrimaryConnectionTarget",
    environmentId: LOCAL_ENVIRONMENT_ID,
    label: LOCAL_ENVIRONMENT_LABEL,
    httpBaseUrl: LOCAL_ASSET_BASE_URL,
  },
  profile: Option.none(),
  enabled: true,
};

export const LOCAL_CONNECTION_ENTRY = LOCAL_ENTRY;

export const LOCAL_PREPARED_CONNECTION: PreparedConnection = {
  environmentId: LOCAL_ENVIRONMENT_ID,
  label: LOCAL_ENVIRONMENT_LABEL,
  httpBaseUrl: LOCAL_ASSET_BASE_URL,
  socketUrl: "",
  httpAuthorization: null,
  target: LOCAL_ENTRY.target,
};

export const environmentCatalogAtom = Atom.make<EnvironmentCatalogState>({
  isReady: true,
  entries: new Map([[LOCAL_ENVIRONMENT_ID, LOCAL_ENTRY]]),
}).pipe(Atom.keepAlive, Atom.withLabel("kuru:environment-catalog"));

/** T3 Code's connection/catalog.ts atoms: the catalog, and the network kuru code never waits on. */
export const environmentCatalog = {
  catalogValueAtom: environmentCatalogAtom,
  networkStatusValueAtom: Atom.make({ online: true } as const),
};

function withoutProviders(config: import("~/contracts").ServerConfig): EnvironmentServerConfig {
  const { providers: _providers, ...rest } = config;
  return rest;
}

let lastConfig: import("~/contracts").ServerConfig | null = null;
let lastStripped: EnvironmentServerConfig | null = null;
const serverConfigsAtom = Atom.make((get): ReadonlyMap<EnvironmentId, EnvironmentServerConfig> => {
  const config = get(serverConfigAtom(LOCAL_ENVIRONMENT_ID));
  if (config === null) return new Map();
  if (config !== lastConfig) {
    const stripped = withoutProviders(config);
    // Provider pushes alone keep the config without them unchanged.
    if (lastStripped === null || JSON.stringify(lastStripped) !== JSON.stringify(stripped)) lastStripped = stripped;
    lastConfig = config;
  }
  return new Map([[LOCAL_ENVIRONMENT_ID, lastStripped!]]);
}).pipe(Atom.withLabel("kuru:server-configs"));

const presentationsAtom = Atom.make((get): ReadonlyMap<EnvironmentId, EnvironmentPresentation> => {
  const serverConfig = get(serverConfigsAtom).get(LOCAL_ENVIRONMENT_ID) ?? null;
  return new Map([
    [
      LOCAL_ENVIRONMENT_ID,
      { entry: LOCAL_ENTRY, connection: { phase: "connected", error: null, traceId: null }, serverConfig },
    ],
  ]);
}).pipe(Atom.withLabel("kuru:environment-presentations"));

const providersByEnvironmentAtom = Atom.make((get): ReadonlyMap<EnvironmentId, ReadonlyArray<ServerProvider>> => {
  const providers = get(serverConfigAtom(LOCAL_ENVIRONMENT_ID))?.providers ?? [];
  return new Map([[LOCAL_ENVIRONMENT_ID, providers]]);
}).pipe(Atom.withLabel("kuru:providers-by-environment"));

/** T3 Code's state/presentation.ts atoms for kuru code's one environment. */
export const environmentPresentations = {
  presentationsAtom,
  serverConfigsAtom,
  providersByEnvironmentAtom,
  presentationAtom: (environmentId: EnvironmentId | null) =>
    Atom.make((get) => (environmentId === null ? null : (get(presentationsAtom).get(environmentId) ?? null))),
};

export function useServerConfigs(): ReadonlyMap<EnvironmentId, EnvironmentServerConfig> {
  return useAtomValue(serverConfigsAtom);
}

const CONNECTED: readonly EnvironmentId[] = [LOCAL_ENVIRONMENT_ID];

export function useConnectedEnvironmentIds(): readonly EnvironmentId[] {
  return CONNECTED;
}

export function usePrimaryEnvironmentId(): EnvironmentId {
  return LOCAL_ENVIRONMENT_ID;
}
