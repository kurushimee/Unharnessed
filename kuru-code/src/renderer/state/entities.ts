// T3 Code's state/entities.ts: the shells the window reads, from kuru code's app state.
import type { EnvironmentId } from "~/contracts";
import { useStore } from "~/state";
export {
  useThreadShell,
  useThreadShell as useQuietThreadShell,
  useProject,
  useProjects,
  useThreadShells,
  useThreadShells as useQuietThreadShells,
  readThreadShell,
  readProject,
} from "~/kuru/shells";
export { useServerConfigs } from "~/kuru/environment";
import { readShells, useThreadShells as useThreadShellsList } from "~/kuru/shells";
import type { EnvironmentThreadShell } from "~/rt/state/models";

const EMPTY_SHELLS: ReadonlyArray<EnvironmentThreadShell> = [];

export const readProjects = () => readShells().projects;
export const readThreadShells = () => readShells().threads;

/** T3 Code lists tasks other environments run for a thread under it; kuru code has none. */
const NONE: ReadonlySet<string> = new Set();
export function useDelegatedUnderParent(): ReadonlySet<string> {
  return NONE;
}

/** Whether every environment's projects have loaded: kuru code's, once the sessions folder was read. */
export function useAllEnvironmentProjectSnapshotsReady(): boolean {
  return useStore((state) => state.app?.loaded ?? false);
}

export function readEnvironmentThreadRefs(_environmentId: EnvironmentId) {
  return readShells().threads.map((thread) => ({
    environmentId: thread.environmentId,
    threadId: thread.id,
  }));
}

/** Whether the environment's settings have loaded: kuru code's are read with its app state. */
export function readEnvironmentServerConfigLoaded(_environmentId: EnvironmentId): boolean {
  return true;
}

/** kuru code keeps each thread's auto-settle choice in its notes. */
export function readEnvironmentSupportsAutoSettleOptOut(_environmentId: EnvironmentId): boolean {
  return true;
}

/** The threads lists show: those not archived (Unharnessed has no hidden subagent threads). */
let visibleCache: { all: ReadonlyArray<EnvironmentThreadShell>; visible: ReadonlyArray<EnvironmentThreadShell> } | null = null;
export function useVisibleThreadShells(enabled = true) {
  const threads = useThreadShellsList();
  if (!enabled) return EMPTY_SHELLS;
  if (visibleCache?.all !== threads) {
    visibleCache = { all: threads, visible: threads.filter((thread) => thread.archivedAt == null) };
  }
  return visibleCache.visible;
}

/** Whether the threads have been read: the sessions folder's first read. */
export function useAllEnvironmentShellsBootstrapped(): boolean {
  return useStore((state) => state.app?.loaded ?? false);
}
