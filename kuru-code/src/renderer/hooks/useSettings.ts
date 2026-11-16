// Adapted from T3 Code's hooks/useSettings.ts: the app's client settings,
// kept by the main process (as T3 Code's desktop app keeps them) and read
// through a store. T3 Code's server settings are Unharnessed's own settings
// here, which its settings tabs edit through the agent (see ~/state).
import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import {
  type ClientSettingsPatch,
  type ClientSettings,
  DEFAULT_CLIENT_SETTINGS,
  type EnvironmentIdentificationMode,
} from "~/contracts/settings";
import * as Equal from "effect/Equal";
import * as Struct from "effect/Struct";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { use, useRef } from "react";
import {
  DEFAULT_SERVER_SETTINGS,
  LOCAL_ENVIRONMENT_ID,
  type EnvironmentId,
  type ProviderInstanceMutation,
  type ProviderInstanceId,
  ServerSettings,
  type ServerSettingsPatch,
} from "~/contracts";
import type { UnifiedSettings } from "~/contracts/settings";
import { AsyncResult, Atom } from "effect/reactivity";
import { isAtomCommandInterrupted, squashAtomCommandFailure } from "~/rt/state/runtime";
import { modelPreferencesMigrationPatch, resolveModelPreferences } from "~/shared/serverSettings";
import { toastManager } from "~/components/ui/toast";
import { primaryServerSettingsAtom, serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { ensureLocalApi } from "~/localApi";

function safeErrorLogAttributes(error: unknown) {
  return { error: error instanceof Error ? error.message : String(error) };
}

const CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE = "[CLIENT_SETTINGS]";

const clientSettingsListeners = new Set<() => void>();
const clientSettingsHydrationListeners = new Set<() => void>();
type ClientSettingsHydrationStatus = "pending" | "ready" | "failed" | "retrying";
let clientSettingsSnapshot = DEFAULT_CLIENT_SETTINGS;
let clientSettingsHydrationStatus: ClientSettingsHydrationStatus = "pending";
let clientSettingsHydrationPromise: Promise<void> | null = null;
let clientSettingsHydrationGeneration = 0;
let clientSettingsPersistenceQueue: Promise<void> = Promise.resolve();
let deferredClientSettingsPatchCount = 0;

function emitClientSettingsChange() {
  for (const listener of clientSettingsListeners) {
    listener();
  }
}

function emitClientSettingsHydrationChange() {
  for (const listener of clientSettingsHydrationListeners) {
    listener();
  }
}

function getClientSettingsSnapshot(): ClientSettings {
  return clientSettingsSnapshot;
}

function replaceClientSettingsSnapshot(settings: ClientSettings): void {
  clientSettingsSnapshot = settings;
  emitClientSettingsChange();
}

function setClientSettingsHydrationStatus(nextStatus: ClientSettingsHydrationStatus): void {
  if (clientSettingsHydrationStatus === nextStatus) {
    return;
  }
  clientSettingsHydrationStatus = nextStatus;
  emitClientSettingsHydrationChange();
}

export function subscribeClientSettings(listener: () => void): () => void {
  clientSettingsListeners.add(listener);
  void hydrateClientSettings().catch(() => undefined);
  return () => {
    clientSettingsListeners.delete(listener);
  };
}

export function getClientSettingsHydratedSnapshot(): boolean {
  return clientSettingsHydrationStatus === "ready";
}

function getClientSettingsHydrationStatusSnapshot(): ClientSettingsHydrationStatus {
  return clientSettingsHydrationStatus;
}

export function subscribeClientSettingsHydration(listener: () => void): () => void {
  clientSettingsHydrationListeners.add(listener);
  void hydrateClientSettings().catch(() => undefined);
  return () => {
    clientSettingsHydrationListeners.delete(listener);
  };
}

async function hydrateClientSettings(): Promise<void> {
  if (clientSettingsHydrationStatus === "ready") {
    return;
  }
  if (clientSettingsHydrationPromise) {
    return clientSettingsHydrationPromise;
  }

  const hydrationGeneration = clientSettingsHydrationGeneration;
  setClientSettingsHydrationStatus(
    clientSettingsHydrationStatus === "failed" || clientSettingsHydrationStatus === "retrying"
      ? "retrying"
      : "pending",
  );
  const nextHydration = (async () => {
    try {
      const persistedSettings = await ensureLocalApi().persistence.getClientSettings();
      if (hydrationGeneration !== clientSettingsHydrationGeneration) {
        return;
      }
      if (persistedSettings) {
        replaceClientSettingsSnapshot({ ...DEFAULT_CLIENT_SETTINGS, ...persistedSettings });
      }
      setClientSettingsHydrationStatus("ready");
    } catch (error) {
      if (hydrationGeneration === clientSettingsHydrationGeneration) {
        setClientSettingsHydrationStatus("failed");
      }
      console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} hydrate failed`, {
        operation: "hydrate",
        ...safeErrorLogAttributes(error),
      });
      throw error;
    }
  })();

  const hydrationPromise = nextHydration.finally(() => {
    if (clientSettingsHydrationPromise === hydrationPromise) {
      clientSettingsHydrationPromise = null;
    }
  });
  clientSettingsHydrationPromise = hydrationPromise;

  return clientSettingsHydrationPromise;
}

const defaultClientSettingsPersistence = (settings: ClientSettings): Promise<void> =>
  ensureLocalApi().persistence.setClientSettings(settings);

function enqueueClientSettingsPersistence<A>(work: () => Promise<A>): Promise<A> {
  const result = clientSettingsPersistenceQueue.then(work);
  clientSettingsPersistenceQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function persistClientSettingsPatch(
  patch: ClientSettingsPatch,
  persist: (settings: ClientSettings) => Promise<void> = defaultClientSettingsPersistence,
): Promise<void> {
  // Patches queued before hydration must publish before newer optimistic patches.
  const deferPatch =
    clientSettingsHydrationStatus !== "ready" || deferredClientSettingsPatchCount > 0;
  if (deferPatch) {
    deferredClientSettingsPatchCount += 1;
  } else {
    replaceClientSettingsSnapshot({ ...getClientSettingsSnapshot(), ...patch });
  }
  return enqueueClientSettingsPersistence(async () => {
    if (deferPatch) {
      try {
        if (clientSettingsHydrationStatus !== "ready") {
          await hydrateClientSettings();
        }
        replaceClientSettingsSnapshot({ ...getClientSettingsSnapshot(), ...patch });
      } finally {
        deferredClientSettingsPatchCount -= 1;
      }
    }
    await persist(getClientSettingsSnapshot());
  }).catch((error) => {
    console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} persist failed`, {
      operation: "persist",
      ...safeErrorLogAttributes(error),
    });
  });
}

/** Reapply to newer snapshots after pending writes to avoid losing concurrent changes. */
export async function persistClientSettingsUpdate(
  update: (current: ClientSettings) => ClientSettings,
  persist: (settings: ClientSettings) => Promise<void> = defaultClientSettingsPersistence,
): Promise<ClientSettings> {
  return enqueueClientSettingsPersistence(async () => {
    if (clientSettingsHydrationStatus !== "ready") {
      await hydrateClientSettings();
    }
    for (;;) {
      const current = getClientSettingsSnapshot();
      const next = update(current);
      await persist(next);
      if (getClientSettingsSnapshot() === current) {
        replaceClientSettingsSnapshot(next);
        return next;
      }
    }
  });
}

export function getClientSettings(): ClientSettings {
  return getClientSettingsSnapshot();
}

export function isClientSettingsHydrated(): boolean {
  return getClientSettingsHydratedSnapshot();
}

/** Failed reads reject and remain retryable so defaults cannot overwrite saved preferences. */
export function ensureClientSettingsHydrated(): Promise<void> {
  return hydrateClientSettings();
}

export function useClientSettingsHydrated(): boolean {
  return useSyncExternalStore(
    subscribeClientSettingsHydration,
    getClientSettingsHydratedSnapshot,
    () => false,
  );
}

export function useClientSettingsHydrationStatus(): ClientSettingsHydrationStatus {
  return useSyncExternalStore(
    subscribeClientSettingsHydration,
    getClientSettingsHydrationStatusSnapshot,
    () => "pending",
  );
}

const getDefaultClientSettings = () => DEFAULT_CLIENT_SETTINGS;
const selectWholeClientSettings = (settings: ClientSettings) => settings;

/** Structurally equal selections retain their reference and skip rendering. */
export function useClientSettings<T = ClientSettings>(
  selector?: (settings: ClientSettings) => T,
): T {
  return useSyncExternalStoreWithSelector(
    subscribeClientSettings,
    getClientSettingsSnapshot,
    getDefaultClientSettings,
    selector ?? (selectWholeClientSettings as (settings: ClientSettings) => T),
    Equal.equals,
  );
}

/** kuru code runs on one machine: no environment is told apart. */
export function useEnvironmentIdentificationMode(): EnvironmentIdentificationMode {
  return "none";
}

export function updateClientSettings(patch: ClientSettingsPatch): Promise<void> {
  return persistClientSettingsPatch(patch);
}

// ---- T3 Code's server settings: kuru code's environment's (kuru/serverConfig.ts), merged
// with the client's as T3 Code merges them.

type UnifiedSettingsPatch = ServerSettingsPatch & ClientSettingsPatch;

const SERVER_SETTINGS_KEYS = new Set<string>(Struct.keys(ServerSettings.fields));

function splitPatch(patch: UnifiedSettingsPatch): {
  serverPatch: ServerSettingsPatch;
  clientPatch: ClientSettingsPatch;
} {
  const serverPatch: Record<string, unknown> = {};
  const clientPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SERVER_SETTINGS_KEYS.has(key)) {
      serverPatch[key] = value;
    } else {
      clientPatch[key] = value;
    }
  }
  return {
    serverPatch: serverPatch as ServerSettingsPatch,
    clientPatch: clientPatch as ClientSettingsPatch,
  };
}

export function mergeEnvironmentSettings(
  serverSettings: ServerSettings,
  clientSettings: ClientSettings,
): UnifiedSettings {
  // Older untyped adapters can return retired client keys; server values must win.
  return {
    ...clientSettings,
    ...serverSettings,
    ...resolveModelPreferences(serverSettings, clientSettings),
  };
}

const selectLegacyModelPreferences = (settings: ClientSettings) => ({
  favorites: settings.favorites,
  providerModelPreferences: settings.providerModelPreferences,
});

export function useMergedSettings<T = UnifiedSettings>(
  serverSettings: ServerSettings,
  selector?: (settings: UnifiedSettings) => T,
): T {
  return useClientSettings((clientSettings) => {
    const merged = mergeEnvironmentSettings(serverSettings, clientSettings);
    return selector ? selector(merged) : (merged as T);
  });
}

export async function prepareModelPreferencesPatch(
  settings: ServerSettings,
  patch: ServerSettingsPatch,
): Promise<ServerSettingsPatch> {
  if (settings.favorites === null || settings.providerModelPreferences === null) {
    await ensureClientSettingsHydrated();
  }
  return { ...modelPreferencesMigrationPatch(settings, getClientSettings()), ...patch };
}

export function useUpdateEnvironmentModelPreferences(environmentId: EnvironmentId | null) {
  const settings = useAtomValue(
    environmentId ? serverEnvironment.settingsValueAtom(environmentId) : noEnvironmentSettingsAtom,
  );
  const save = useAtomCommand(serverEnvironment.updateSettings, "model preferences update");
  return async (patch: ServerSettingsPatch) => {
    if (!environmentId || !settings) return;
    let prepared: ServerSettingsPatch;
    try {
      prepared = await prepareModelPreferencesPatch(settings, patch);
    } catch {
      toastManager.add({
        type: "error",
        title: "Model preferences not saved",
        description: "Could not load saved model preferences. Try again.",
      });
      return;
    }
    return save({ environmentId, input: { patch: prepared } });
  };
}

/** Send the desired state so two clients adding a favorite do not cancel each other. */
export function useToggleEnvironmentModelFavorite(environmentId: EnvironmentId | null) {
  const registry = use(RegistryContext);
  const pendingFavorites = useRef(
    new Map<string, { favorite: boolean; settings: ServerSettings; pending: boolean }>(),
  );
  const save = useUpdateEnvironmentModelPreferences(environmentId);
  return async (provider: ProviderInstanceId, model: string) => {
    if (!environmentId) return;
    const settingsAtom = serverEnvironment.settingsValueAtom(environmentId);
    const settings = registry.get(settingsAtom);
    if (!settings) return;
    if (settings.favorites === null) {
      try {
        await ensureClientSettingsHydrated();
      } catch {
        toastManager.add({
          type: "error",
          title: "Favorites not saved",
          description: "Could not load saved model preferences. Try again.",
        });
        return;
      }
    }
    const currentSettings = registry.get(settingsAtom) ?? settings;
    const favorites = resolveModelPreferences(currentSettings, getClientSettings()).favorites;
    const key = JSON.stringify([environmentId, provider, model]);
    const previous = pendingFavorites.current.get(key);
    // Keep the acknowledged choice until the config stream catches up with the RPC reply.
    const previousFavorite =
      previous && (previous.pending || previous.settings.favorites === currentSettings.favorites)
        ? previous.favorite
        : favorites.some((favorite) => favorite.provider === provider && favorite.model === model);
    const pending = {
      favorite: !previousFavorite,
      settings: currentSettings,
      pending: true,
    };
    pendingFavorites.current.set(key, pending);
    const result = await save({
      setModelFavorites: [{ provider, model, favorite: pending.favorite }],
    });
    if (
      result &&
      AsyncResult.isSuccess(result) &&
      registry.get(settingsAtom)?.favorites === currentSettings.favorites
    ) {
      pending.pending = false;
    }
    if (pending.pending && pendingFavorites.current.get(key) === pending) {
      if (
        previous &&
        !previous.pending &&
        registry.get(settingsAtom)?.favorites === previous.settings.favorites
      ) {
        pendingFavorites.current.set(key, previous);
      } else {
        pendingFavorites.current.delete(key);
      }
    }
  };
}

const noEnvironmentSettingsAtom = Atom.make<ServerSettings | null>(null);

export function useEnvironmentModelPreferences(environmentId: EnvironmentId | null) {
  const settings = useAtomValue(
    environmentId ? serverEnvironment.settingsValueAtom(environmentId) : noEnvironmentSettingsAtom,
  );
  const legacy = useClientSettings(selectLegacyModelPreferences);
  return resolveModelPreferences(settings ?? DEFAULT_SERVER_SETTINGS, legacy);
}

export function useEnvironmentSettings<T = UnifiedSettings>(
  environmentId: EnvironmentId,
  selector?: (settings: UnifiedSettings) => T,
): T {
  const serverSettings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  return useMergedSettings(serverSettings ?? DEFAULT_SERVER_SETTINGS, selector);
}

export function usePersistEnvironmentProviderInstanceMutation(environmentId: EnvironmentId) {
  const mutateProviderInstance = useAtomCommand(serverEnvironment.mutateProviderInstance, {
    reportFailure: false,
  });
  return (providerInstanceMutation: ProviderInstanceMutation, patch: ServerSettingsPatch = {}) =>
    mutateProviderInstance({
      environmentId,
      input: { patch, providerInstanceMutation },
    });
}

export function usePrimarySettings<T = UnifiedSettings>(
  selector?: (settings: UnifiedSettings) => T,
): T {
  const settings = useAtomValue(primaryServerSettingsAtom);
  return useMergedSettings(settings, selector);
}

export const PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE =
  "This setting is saved on a server, and the hosted app is not anchored to one. Change it from the desktop app or from the server's own address.";

/** kuru code's primary environment is always this machine. */
export function usePrimarySettingsAvailable(): boolean {
  return true;
}

/** T3 Code's settings writer for one environment: the server part to it, the rest to the client. */
function useUpdateSettingsTarget(environmentId: EnvironmentId | null) {
  const persist = useAtomCommand(serverEnvironment.updateSettings, {
    label: "server settings update",
    reportFailure: false,
  });
  return (
    patch: UnifiedSettingsPatch,
    options?: { readonly onFailed?: () => void; readonly onSaved?: () => void },
  ) => {
    const { serverPatch, clientPatch } = splitPatch(patch);
    if (Object.keys(serverPatch).length > 0) {
      const target = environmentId ?? LOCAL_ENVIRONMENT_ID;
      void persist({ environmentId: target, input: { patch: serverPatch } }).then((result) => {
        if (result._tag === "Success") {
          options?.onSaved?.();
          return;
        }
        options?.onFailed?.();
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Setting not saved",
          description: error instanceof Error ? error.message : "The save failed.",
        });
      });
    }
    if (Object.keys(clientPatch).length > 0) {
      void persistClientSettingsPatch(clientPatch);
    }
  };
}

export function useUpdateEnvironmentSettings(environmentId: EnvironmentId | null) {
  return useUpdateSettingsTarget(environmentId);
}

export function useUpdatePrimarySettings() {
  return useUpdateSettingsTarget(LOCAL_ENVIRONMENT_ID);
}
