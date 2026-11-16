import { scopedThreadKey } from "~/rt/environment/index";
import type { ScopedThreadRef } from "~/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

/** Whether the thread details card sits beside the chat or opens as a popover from its toggle. */
export type ThreadPanelPresentation = "inline" | "popover";

export interface ThreadPanelVisibility {
  inlineOpen: boolean;
  popoverOpen: boolean;
}

interface ThreadPanelStoreState {
  threadPanelVisibilityByThreadKey: Record<string, ThreadPanelVisibility>;
  setThreadPanelOpen: (
    ref: ScopedThreadRef,
    presentation: ThreadPanelPresentation,
    open: boolean,
  ) => void;
  toggleThreadPanel: (ref: ScopedThreadRef, presentation: ThreadPanelPresentation) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

const THREAD_PANEL_STORAGE_KEY = "kuru:thread-panel:v1";

const DEFAULT_THREAD_PANEL_VISIBILITY: ThreadPanelVisibility = {
  inlineOpen: true,
  popoverOpen: false,
};

const updateThreadPanelVisibilityMap = (
  byThreadKey: Record<string, ThreadPanelVisibility>,
  threadKey: string,
  updater: (current: ThreadPanelVisibility) => ThreadPanelVisibility,
): Record<string, ThreadPanelVisibility> => {
  const current = byThreadKey[threadKey] ?? DEFAULT_THREAD_PANEL_VISIBILITY;
  const next = updater(current);
  if (next.inlineOpen && !next.popoverOpen) {
    if (!(threadKey in byThreadKey)) return byThreadKey;
    const { [threadKey]: _removed, ...rest } = byThreadKey;
    return rest;
  }
  if (next === current) return byThreadKey;
  return { ...byThreadKey, [threadKey]: next };
};

export const useThreadPanelStore = create<ThreadPanelStoreState>()(
  persist(
    (set) => ({
      threadPanelVisibilityByThreadKey: {},
      setThreadPanelOpen: (ref, presentation, open) =>
        set((state) => ({
          threadPanelVisibilityByThreadKey: updateThreadPanelVisibilityMap(
            state.threadPanelVisibilityByThreadKey,
            scopedThreadKey(ref),
            (visibility) => {
              const key = presentation === "inline" ? "inlineOpen" : "popoverOpen";
              return visibility[key] === open ? visibility : { ...visibility, [key]: open };
            },
          ),
        })),
      toggleThreadPanel: (ref, presentation) =>
        set((state) => ({
          threadPanelVisibilityByThreadKey: updateThreadPanelVisibilityMap(
            state.threadPanelVisibilityByThreadKey,
            scopedThreadKey(ref),
            (visibility) =>
              presentation === "inline"
                ? { ...visibility, inlineOpen: !visibility.inlineOpen }
                : { ...visibility, popoverOpen: !visibility.popoverOpen },
          ),
        })),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (!(threadKey in state.threadPanelVisibilityByThreadKey)) return state;
          const { [threadKey]: _visibility, ...threadPanelVisibilityByThreadKey } =
            state.threadPanelVisibilityByThreadKey;
          return { threadPanelVisibilityByThreadKey };
        }),
    }),
    {
      name: THREAD_PANEL_STORAGE_KEY,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        threadPanelVisibilityByThreadKey: Object.fromEntries(
          Object.entries(state.threadPanelVisibilityByThreadKey).flatMap(
            ([threadKey, visibility]) =>
              visibility.inlineOpen ? [] : [[threadKey, { inlineOpen: false, popoverOpen: false }]],
          ),
        ),
      }),
    },
  ),
);

export function selectThreadPanelVisibility(
  byThreadKey: Record<string, ThreadPanelVisibility>,
  ref: ScopedThreadRef | null | undefined,
): ThreadPanelVisibility {
  if (!ref) return DEFAULT_THREAD_PANEL_VISIBILITY;
  return byThreadKey[scopedThreadKey(ref)] ?? DEFAULT_THREAD_PANEL_VISIBILITY;
}

export function selectThreadPanelOpen(
  byThreadKey: Record<string, ThreadPanelVisibility>,
  ref: ScopedThreadRef | null | undefined,
  presentation: ThreadPanelPresentation,
): boolean {
  const visibility = selectThreadPanelVisibility(byThreadKey, ref);
  return presentation === "inline" ? visibility.inlineOpen : visibility.popoverOpen;
}
