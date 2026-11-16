// From T3 Code's rightPanelStore.ts. T3 Code's right panel held a thread's diff, files, browser,
// terminals and pull requests; kuru code has no right panel beside a thread, and keeps only the
// Pull requests page's: its open pull requests as tabs. T3 Code never saved that page's tabs, so
// neither does this store.
import { scopedThreadKey, scopeThreadRef } from "~/rt/environment/index";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "~/contracts";
import { create } from "zustand";

export type RightPanelKind = "pull-request";

export type PullRequestDetailTab = "summary" | "guide" | "timeline" | "code";

export type RightPanelSurface = {
  id: `pull-request:${string}`;
  kind: "pull-request";
  /** Cross-environment lists can repeat project ids; thread panels inherit their ref's environment. */
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
  url?: string;
  /** A clicked link waiting for the panel to show where it points; cleared once shown. */
  revealUrl?: string;
  detailTab?: PullRequestDetailTab;
};

export const PULL_REQUESTS_PANEL_REF = scopeThreadRef(
  EnvironmentId.make("pull-requests-panel"),
  ThreadId.make("pull-requests-panel"),
);

export interface ThreadRightPanelState {
  isOpen: boolean;
  activeSurfaceId: string | null;
  surfaces: RightPanelSurface[];
}

type PullRequestTarget = {
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
  url?: string;
  revealUrl?: string;
  detailTab?: PullRequestDetailTab;
};

interface RightPanelStoreState {
  byThreadKey: Record<string, ThreadRightPanelState>;
  openPullRequest: (ref: ScopedThreadRef, target: PullRequestTarget) => void;
  setPullRequestDetailTab: (
    ref: ScopedThreadRef,
    surfaceId: string,
    detailTab: PullRequestDetailTab,
  ) => void;
  settlePullRequestReveal: (ref: ScopedThreadRef, surfaceId: string, revealUrl: string) => void;
  activateSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeOtherSurfaces: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeSurfacesToRight: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeAllSurfaces: (ref: ScopedThreadRef) => void;
  moveSurface: (ref: ScopedThreadRef, surfaceId: string, toIndex: number) => void;
  show: (ref: ScopedThreadRef) => void;
  close: (ref: ScopedThreadRef) => void;
}

const EMPTY_THREAD_STATE: ThreadRightPanelState = {
  isOpen: false,
  activeSurfaceId: null,
  surfaces: [],
};

export type PullRequestSurface = RightPanelSurface;

export function pullRequestSurfaceId(target: {
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
}): PullRequestSurface["id"] {
  const scope =
    target.environmentId === undefined ? "" : `${encodeURIComponent(target.environmentId)}:`;
  const host = target.host === undefined ? "" : `${encodeURIComponent(target.host.toLowerCase())}:`;
  return `pull-request:${scope}${encodeURIComponent(target.projectId)}:${host}${encodeURIComponent(target.repository)}:${target.number}`;
}

export function pullRequestSurface(target: {
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
  url?: string;
  detailTab?: PullRequestDetailTab;
}): PullRequestSurface {
  return {
    id: pullRequestSurfaceId(target),
    kind: "pull-request",
    ...(target.environmentId === undefined ? {} : { environmentId: target.environmentId }),
    projectId: target.projectId,
    ...(typeof target.host === "string" ? { host: target.host.toLowerCase() } : {}),
    repository: target.repository,
    number: target.number,
    ...(typeof target.url === "string" ? { url: target.url } : {}),
    ...(target.detailTab === undefined ? {} : { detailTab: target.detailTab }),
  };
}

/** A pending link belongs to the click that made it, not to a reload or a reopen. */
const withoutReveal = (surface: RightPanelSurface): RightPanelSurface => {
  if (surface.revealUrl === undefined) return surface;
  const { revealUrl: _pending, ...rest } = surface;
  return rest;
};

const upsertSurface = (
  current: ThreadRightPanelState,
  surface: RightPanelSurface,
  activate = true,
): ThreadRightPanelState => ({
  ...current,
  isOpen: true,
  surfaces: current.surfaces.some((entry) => entry.id === surface.id)
    ? current.surfaces
    : [...current.surfaces, surface],
  activeSurfaceId: activate ? surface.id : current.activeSurfaceId,
});

const updateThread = (
  state: Pick<RightPanelStoreState, "byThreadKey">,
  threadKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): Pick<RightPanelStoreState, "byThreadKey"> => {
  const byThreadKey = state.byThreadKey;
  const current = byThreadKey[threadKey] ?? EMPTY_THREAD_STATE;
  const next = updater(current);
  if (!next.isOpen && next.activeSurfaceId === null && next.surfaces.length === 0) {
    if (!(threadKey in byThreadKey)) return state;
    const { [threadKey]: _removed, ...rest } = byThreadKey;
    return { byThreadKey: rest };
  }
  if (next === current) return state;
  return { byThreadKey: { ...byThreadKey, [threadKey]: next } };
};

const activated = (current: ThreadRightPanelState, surfaceId: string): ThreadRightPanelState =>
  current.surfaces.some((surface) => surface.id === surfaceId)
    ? { ...current, isOpen: true, activeSurfaceId: surfaceId }
    : current;

export const useRightPanelStore = create<RightPanelStoreState>()((set) => ({
  byThreadKey: {},
  openPullRequest: (ref, target) =>
    set((state) =>
      updateThread(state, scopedThreadKey(ref), (current) => {
        const surface = pullRequestSurface(target);
        const next = upsertSurface(current, surface);
        const { url, revealUrl } = target;
        if (!url && !revealUrl) return next;
        return {
          ...next,
          surfaces: next.surfaces.map((entry) => {
            if (entry.id !== surface.id) return entry;
            // A later link replaces one not yet shown.
            const { revealUrl: _previous, ...rest } = entry;
            return { ...rest, ...surface, ...(revealUrl ? { revealUrl } : {}) };
          }),
        };
      }),
    ),
  setPullRequestDetailTab: (ref, surfaceId, detailTab) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const existing = state.byThreadKey[threadKey]?.surfaces.find(
        (surface) => surface.id === surfaceId,
      );
      if (existing === undefined || (existing.detailTab ?? "summary") === detailTab) return state;
      return updateThread(state, threadKey, (current) => ({
        ...current,
        surfaces: current.surfaces.map((surface) =>
          surface.id === surfaceId ? { ...surface, detailTab } : surface,
        ),
      }));
    }),
  settlePullRequestReveal: (ref, surfaceId, revealUrl) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const existing = state.byThreadKey[threadKey]?.surfaces.find(
        (surface) => surface.id === surfaceId,
      );
      if (existing === undefined || existing.revealUrl !== revealUrl) return state;
      return updateThread(state, threadKey, (current) => ({
        ...current,
        surfaces: current.surfaces.map((surface) =>
          surface.id === surfaceId ? withoutReveal(surface) : surface,
        ),
      }));
    }),
  activateSurface: (ref, surfaceId) =>
    set((state) =>
      updateThread(state, scopedThreadKey(ref), (current) => activated(current, surfaceId)),
    ),
  closeSurface: (ref, surfaceId) =>
    set((state) =>
      updateThread(state, scopedThreadKey(ref), (current) => {
        const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
        if (index < 0) return current;
        const surfaces = current.surfaces.filter((surface) => surface.id !== surfaceId);
        const next = {
          ...current,
          isOpen: surfaces.length > 0 && current.isOpen,
          surfaces,
        };
        if (current.activeSurfaceId !== surfaceId) {
          return next;
        }
        const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
        return {
          ...next,
          activeSurfaceId: fallback?.id ?? null,
        };
      }),
    ),
  closeOtherSurfaces: (ref, surfaceId) =>
    set((state) =>
      updateThread(state, scopedThreadKey(ref), (current) => {
        const surface = current.surfaces.find((entry) => entry.id === surfaceId);
        if (!surface || current.surfaces.length === 1) return current;
        return {
          ...current,
          isOpen: true,
          surfaces: [surface],
          activeSurfaceId: surface.id,
        };
      }),
    ),
  closeSurfacesToRight: (ref, surfaceId) =>
    set((state) =>
      updateThread(state, scopedThreadKey(ref), (current) => {
        const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
        if (index < 0 || index === current.surfaces.length - 1) return current;
        const surfaces = current.surfaces.slice(0, index + 1);
        const activeStillExists = surfaces.some(
          (surface) => surface.id === current.activeSurfaceId,
        );
        return {
          ...current,
          surfaces,
          activeSurfaceId: activeStillExists ? current.activeSurfaceId : surfaceId,
        };
      }),
    ),
  closeAllSurfaces: (ref) =>
    set((state) =>
      updateThread(state, scopedThreadKey(ref), (current) =>
        current.surfaces.length === 0
          ? current
          : { ...current, isOpen: false, surfaces: [], activeSurfaceId: null },
      ),
    ),
  moveSurface: (ref, surfaceId, toIndex) =>
    set((state) =>
      updateThread(state, scopedThreadKey(ref), (current) => {
        const fromIndex = current.surfaces.findIndex((surface) => surface.id === surfaceId);
        if (fromIndex < 0 || fromIndex === toIndex) return current;
        const surfaces = [...current.surfaces];
        surfaces.splice(toIndex, 0, ...surfaces.splice(fromIndex, 1));
        return { ...current, surfaces };
      }),
    ),
  show: (ref) =>
    set((state) =>
      updateThread(state, scopedThreadKey(ref), (current) =>
        current.isOpen ? current : { ...current, isOpen: true },
      ),
    ),
  close: (ref) =>
    set((state) =>
      updateThread(state, scopedThreadKey(ref), (current) =>
        current.isOpen ? { ...current, isOpen: false } : current,
      ),
    ),
}));

export function selectThreadRightPanelState(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): ThreadRightPanelState {
  if (!ref) return EMPTY_THREAD_STATE;
  return byThreadKey[scopedThreadKey(ref)] ?? EMPTY_THREAD_STATE;
}

export function selectActiveRightPanelSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  if (!state.isOpen) return null;
  return selectSelectedRightPanelSurface(byThreadKey, ref);
}

export function selectSelectedRightPanelSurface(
  byThreadKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byThreadKey, ref);
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null;
}
