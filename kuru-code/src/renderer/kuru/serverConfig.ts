// T3 Code's server config, for kuru code's one environment: this machine,
// served by kuru code's main process and Unharnessed. Built through T3 Code's
// own schema, so every setting kuru code does not set takes T3 Code's
// default. Its providers are Unharnessed's (kuru/providers.ts).
import {
  DEFAULT_SERVER_SETTINGS,
  LOCAL_ENVIRONMENT_ID,
  ServerConfig,
  ServerSettings,
  type ServerSettingsPatch,
  type EnvironmentId,
  type ServerProvider,
} from "~/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "~/shared/keybindings";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useStore, type Store } from "~/state";
import * as Schema from "effect/Schema";
import { invoke } from "~/bridge";
import { applyServerSettingsPatch } from "~/shared/serverSettings";
import { Atom } from "effect/reactivity";

const decodeConfig = Schema.decodeUnknownSync(ServerConfig);
const encodeKeybindings = (value: unknown) => value;

/** What kuru code's environment can do, in T3 Code's capability names. */
const CAPABILITIES = {
  repositoryIdentity: true,
  pullRequests: true,
  threadSettlement: true,
  threadAutoSettlement: true,
  threadSnooze: true,
  threadPinning: true,
  threadPinReorder: true,
  threadActiveReorder: true,
  threadAutoSettleOptOut: true,
  threadVisitedTracking: true,
  threadStop: true,
  threadPullRequests: true,
  inlineMessageContext: true,
  projectOrganization: true,
  commandOutputStreaming: false,
};

function buildConfig(home: string, providers: ReadonlyArray<ServerProvider>, settings: unknown): ServerConfig {
  const config = decodeConfig({
    environment: {
      environmentId: LOCAL_ENVIRONMENT_ID,
      label: "This computer",
      platform: { os: "windows", arch: "x64" },
      serverVersion: "kuru",
      capabilities: CAPABILITIES,
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: [],
      sessionMethods: [],
      sessionCookieName: "kuru",
    },
    cwd: home,
    keybindingsConfigPath: `${home}/.unharnessed/keybindings.json`,
    keybindings: encodeKeybindings(DEFAULT_RESOLVED_KEYBINDINGS),
    issues: [],
    providers: [],
    availableEditors: ["vscode", "file-manager"],
    observability: {
      logsDirectoryPath: `${home}/.unharnessed/logs`,
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
      otlpLogsEnabled: false,
    },
    settings: settings ?? {},
    scratchWorkspaceRoot: home,
    threadFind: true,
    threadLinkMetadata: true,
  });
  return { ...config, providers };
}

const NO_PROVIDERS: ReadonlyArray<ServerProvider> = [];
let providersSource: () => ReadonlyArray<ServerProvider> = () => NO_PROVIDERS;
/** Where the config's providers come from; set by kuru/providers.ts. */
export function setServerProvidersSource(source: () => ReadonlyArray<ServerProvider>): void {
  providersSource = source;
  refresh(useStore.getState());
}

const configAtom = Atom.make<ServerConfig | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("kuru:server-config"),
);

// T3 Code's server settings: the main process keeps them (encoded), as T3 Code's server does
// in its settings file. Read once at start; each change is saved there.
let storedSettings: unknown = undefined;
let settingsLoaded = false;

let built: {
  home: string;
  providers: ReadonlyArray<ServerProvider>;
  settings: unknown;
  config: ServerConfig;
} | null = null;
function refresh(state: Store): void {
  const home = state.app?.home;
  if (!home || !settingsLoaded) return;
  const providers = providersSource();
  if (built?.home === home && built.providers === providers && built.settings === storedSettings) return;
  try {
    built = { home, providers, settings: storedSettings, config: buildConfig(home, providers, storedSettings) };
  } catch (error) {
    console.error("kuru: the server config did not decode", error);
    return;
  }
  appAtomRegistry.set(configAtom, built.config);
}

let started = false;
export function startServerConfig(): void {
  if (started) return;
  started = true;
  void invoke<Record<string, unknown> | null>("serverSettings.get")
    .catch((error) => {
      console.error("kuru: the server settings did not load", error);
      return null;
    })
    .then((settings) => {
      storedSettings = settings ?? undefined;
      settingsLoaded = true;
      refresh(useStore.getState());
    });
  useStore.subscribe((state, previous) => {
    if (state.app !== previous.app || state.providers !== previous.providers) refresh(state);
  });
}

export function readServerConfig(): ServerConfig | null {
  return appAtomRegistry.get(configAtom);
}

/** The environment's config: kuru code's for its one environment, none for another. */
export const serverConfigAtom = Atom.family((environmentId: EnvironmentId | null) =>
  Atom.make((get) => (environmentId === LOCAL_ENVIRONMENT_ID ? get(configAtom) : null)),
);

const encodeSettings = Schema.encodeSync(ServerSettings);

/** T3 Code's server.updateSettings: the patch applied as its server applies it, then saved. */
export async function updateServerSettings(patch: ServerSettingsPatch): Promise<ServerSettings> {
  const current = readServerConfig()?.settings ?? DEFAULT_SERVER_SETTINGS;
  const next = applyServerSettingsPatch(current, patch);
  const encoded = encodeSettings(next) as Record<string, unknown>;
  await invoke("serverSettings.set", { settings: encoded });
  storedSettings = encoded;
  refresh(useStore.getState());
  return next;
}
