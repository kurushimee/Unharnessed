import type { ScopedThreadRef } from "~/contracts";
import { readLocalApi } from "~/localApi";

/**
 * Opens a link in the system browser. T3 Code could open links in its in-app preview, which
 * kuru code does not have; the thread and modifier options stay for its callers.
 */
export function useOpenLink(_threadRef: ScopedThreadRef | null | undefined): (
  url: string,
  options?: {
    readonly event?: {
      readonly metaKey: boolean;
      readonly ctrlKey: boolean;
      readonly button?: number | undefined;
    };
    readonly threadRef?: ScopedThreadRef | undefined;
  },
) => Promise<void> {
  return async (url) => {
    const api = readLocalApi();
    if (!api) throw new Error("Link opening is unavailable.");
    await api.shell.openExternal(url);
  };
}
