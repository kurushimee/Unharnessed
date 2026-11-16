// Adapted from T3 Code's localApi.ts: what the window asks of its host, here
// kuru code's main process (T3 Code's desktop bridge).
import type { ConfirmDialogOptions, ContextMenuItem, LocalApi } from "~/contracts";
import type { ClientSettings } from "~/contracts";

import { invoke } from "./bridge";
import { requestConfirmDialog } from "./confirmDialog";

let cachedApi: LocalApi | undefined;

export function createLocalApi(): LocalApi {
  return {
    dialogs: {
      pickFolder: async () => invoke<string | null>("dialogs.pickFolder"),
      confirm: async (message, options?: ConfirmDialogOptions) => {
        return requestConfirmDialog(message, options) ?? false;
      },
    },
    shell: {
      openExternal: async (url) => {
        await invoke("shell.openExternal", { url });
      },
    },
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => invoke<T | null>("contextMenu.show", { items, position }),
      // Native menus close themselves.
      close: async () => {},
    },
    persistence: {
      getClientSettings: async () => invoke<ClientSettings | null>("clientSettings.get"),
      setClientSettings: async (settings) => {
        await invoke("clientSettings.set", { settings });
      },
    },
  };
}

export function readLocalApi(): LocalApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedApi) return cachedApi;

  cachedApi = createLocalApi();
  return cachedApi;
}

export function ensureLocalApi(): LocalApi {
  const api = readLocalApi();
  if (!api) {
    throw new Error("Local API not found");
  }
  return api;
}
