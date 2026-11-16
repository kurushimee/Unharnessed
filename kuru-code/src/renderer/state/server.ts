// T3 Code's state/server.ts, for kuru code's one environment: its server
// config is the one kuru/serverConfig.ts builds from Unharnessed and the
// settings the main process keeps. Commands go to the main process as T3 Code's
// RPCs (src/main/rpc.ts); those it has no answer for fail as unsupported.
import {
  DEFAULT_SERVER_SETTINGS,
  LOCAL_ENVIRONMENT_ID,
  WS_METHODS,
  type EditorId,
  type EnvironmentId,
  type EnvironmentTheme,
  type ResolvedKeybindingsConfig,
  type ServerConfig,
  type ProviderInstanceMutation,
  type ServerProvider,
  type ServerSettings,
  type ServerSettingsPatch,
  type ServerRemoveKeybindingInput,
  type ServerUpsertKeybindingInput,
} from "~/contracts";
import { removeKeybinding, upsertKeybinding } from "~/kuru/keybindings";
import { useAtomValue } from "@effect/atom-react";
import { Atom, AsyncResult } from "effect/reactivity";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "~/shared/keybindings";
import { serverConfigAtom, updateServerSettings } from "~/kuru/serverConfig";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createLocalCommand,
} from "~/rt/state/runtime";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";

export const EMPTY_SERVER_PROVIDERS: ReadonlyArray<ServerProvider> = [];
const EMPTY_ENVIRONMENT_THEMES: ReadonlyArray<EnvironmentTheme> = [];
const EMPTY_AVAILABLE_EDITORS: ReadonlyArray<EditorId> = [];

const providersValueFamily = Atom.family((environmentId: EnvironmentId | null) =>
  Atom.make((get) => get(serverConfigAtom(environmentId))?.providers ?? null),
);
const settingsValueFamily = Atom.family((environmentId: EnvironmentId | null) =>
  Atom.make((get) => get(serverConfigAtom(environmentId))?.settings ?? null),
);
const hiddenThreadTagsFamily = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const settings = get(settingsValueFamily(environmentId));
    if (settings?.hideTaggedThreads !== true) return null;
    // Tags are trimmed on write; trim hand-edited entries so " private" still matches.
    const tags = settings.hiddenThreadTags.map((tag) => tag.trim()).filter((tag) => tag !== "");
    return tags.length > 0 ? tags : null;
  }).pipe(
    Atom.withEquality(
      (a: ReadonlyArray<string> | null, b: ReadonlyArray<string> | null) =>
        a === b || (a !== null && b !== null && a.length === b.length && a.every((tag, index) => tag === b[index])),
    ),
  ),
);
const usageModelFilterFamily = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => get(settingsValueFamily(environmentId))?.usageModelFilter).pipe(
    Atom.withEquality((a, b) => JSON.stringify(a) === JSON.stringify(b)),
  ),
);
/** kuru code runs no scheduled tasks. */
const NO_SCHEDULED_TASKS = Atom.make(AsyncResult.success<ReadonlyArray<never>, never>([]));
/** kuru code updates with its installer, not from inside a server. */
const NO_UPDATE_STATE = Atom.make(null);

const updateSettings = createLocalCommand({
  label: "environment-data:server:update-settings",
  execute: async (target: {
    readonly environmentId: EnvironmentId;
    readonly input: {
      readonly patch: ServerSettingsPatch;
      readonly providerInstanceMutation?: ProviderInstanceMutation;
    };
  }) => {
    // T3 Code's provider instances are Unharnessed's providers here; they are set up there.
    if (target.input.providerInstanceMutation !== undefined) {
      throw new Error("kuru code's providers are Unharnessed's: add or change them in Unharnessed.");
    }
    return updateServerSettings(target.input.patch);
  },
});

const rpcCommand = <TTag extends Parameters<typeof createEnvironmentRpcCommand>[1]["tag"]>(label: string, tag: TTag) =>
  createEnvironmentRpcCommand(connectionAtomRuntime, { label, tag });

export const serverEnvironment = {
  configValueAtom: serverConfigAtom,
  providersValueAtom: providersValueFamily,
  settingsValueAtom: settingsValueFamily,
  hiddenThreadTagsAtom: hiddenThreadTagsFamily,
  usageModelFilterAtom: usageModelFilterFamily,
  updateStateAtom: (_environmentId: EnvironmentId | null) => NO_UPDATE_STATE,
  scheduledTasksLive: (_target: { environmentId: EnvironmentId; input: object }) => NO_SCHEDULED_TASKS,
  updateSettings,
  mutateProviderInstance: updateSettings,
  // A cold scan of the session files takes a while, so a window's summary is kept for a minute.
  usageSummary: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:server:usage-summary",
    tag: WS_METHODS.serverGetUsageSummary,
    staleTimeMs: 60_000,
  }),
  refreshUsageRates: rpcCommand("environment-data:server:refresh-usage-rates", WS_METHODS.serverRefreshUsageRates),
  refreshProviders: rpcCommand("environment-data:server:refresh-providers", WS_METHODS.serverRefreshProviders),
  upsertKeybinding: createLocalCommand({
    label: "environment-data:server:upsert-keybinding",
    execute: (target: { readonly environmentId: EnvironmentId; readonly input: ServerUpsertKeybindingInput }) =>
      upsertKeybinding(target.input),
  }),
  removeKeybinding: createLocalCommand({
    label: "environment-data:server:remove-keybinding",
    execute: (target: { readonly environmentId: EnvironmentId; readonly input: ServerRemoveKeybindingInput }) =>
      removeKeybinding(target.input),
  }),
  consumeResetCredit: rpcCommand("environment-data:server:consume-reset-credit", WS_METHODS.providerConsumeResetCredit),
  prepareTriage: rpcCommand("environment-data:server:prepare-triage", WS_METHODS.serverPrepareTriage),
  runScheduledTaskNow: rpcCommand("environment-data:server:scheduled-task:run-now", WS_METHODS.scheduledTasksRunNow),
  setScheduledTaskEnabled: rpcCommand("environment-data:server:scheduled-task:set-enabled", WS_METHODS.scheduledTasksSetEnabled),
  createGuestShare: rpcCommand("environment-data:server:guest-share:create", WS_METHODS.guestShareCreate),
};

/** T3 Code's environment update states: kuru code's one environment is never outdated. */
export const environmentUpdateStatesAtom = Atom.make((): ReadonlyArray<null> => []);
/** T3 Code's outdated-server update; kuru code updates with its installer. */
export const updateOutdatedServer = createLocalCommand({
  label: "environment-data:server:update-outdated",
  execute: async (_target: unknown): Promise<never> => {
    throw new Error("kuru code updates with its installer.");
  },
});

export const environmentServerConfigsAtom = Atom.make((get): ReadonlyMap<EnvironmentId, ServerConfig> => {
  const config = get(serverConfigAtom(LOCAL_ENVIRONMENT_ID));
  return config === null ? new Map() : new Map([[LOCAL_ENVIRONMENT_ID, config]]);
});

export const primaryServerConfigAtom = Atom.make((get): ServerConfig | null => get(serverConfigAtom(LOCAL_ENVIRONMENT_ID)));

export const primaryServerSettingsAtom = Atom.make(
  (get): ServerSettings => get(primaryServerConfigAtom)?.settings ?? DEFAULT_SERVER_SETTINGS,
);

export const primaryServerProvidersAtom = Atom.make(
  (get): ReadonlyArray<ServerProvider> => get(primaryServerConfigAtom)?.providers ?? EMPTY_SERVER_PROVIDERS,
);

export const primaryServerAvailableEditorsAtom = Atom.make(
  (get): ReadonlyArray<EditorId> => get(primaryServerConfigAtom)?.availableEditors ?? EMPTY_AVAILABLE_EDITORS,
);

export const themeServerEnvironmentThemesAtom = Atom.make(
  (get): ReadonlyArray<EnvironmentTheme> => get(primaryServerConfigAtom)?.environmentThemes ?? EMPTY_ENVIRONMENT_THEMES,
);

export const themeServerSettingsAtom = primaryServerSettingsAtom;

export const primaryServerKeybindingsAtom = Atom.make((get): ResolvedKeybindingsConfig => {
  return get(primaryServerConfigAtom)?.keybindings ?? DEFAULT_RESOLVED_KEYBINDINGS;
});

export function readPrimaryServerKeybindings(): ResolvedKeybindingsConfig {
  return appAtomRegistry.get(primaryServerKeybindingsAtom);
}

export function usePrimaryServerKeybindings(): ResolvedKeybindingsConfig {
  return useAtomValue(primaryServerKeybindingsAtom);
}

export const providersIgnoringCheckedAtAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<ServerProvider> => get(providersValueFamily(environmentId)) ?? EMPTY_SERVER_PROVIDERS),
);
