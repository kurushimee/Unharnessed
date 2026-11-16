// T3 Code's state/olderSettledShelf.ts pages older settled threads in from its
// server. kuru code reads every session file at once, so every settled thread
// is already listed and nothing is left to load.
import type { EnvironmentThreadShell } from "~/rt/state/models";

export interface OlderSettledScope {
  readonly environmentId: string;
  readonly projectIds: ReadonlyArray<string> | null;
}

const SHELF = {
  isListed: (_thread: EnvironmentThreadShell) => true,
  unloadedCount: (_visible: ReadonlyArray<EnvironmentThreadShell>) => 0,
  loading: false,
  failed: false,
  retry: () => {},
};

export function useOlderSettledShelf(_input: {
  scopes: ReadonlyArray<OlderSettledScope>;
  expanded: boolean;
  visibleCount: number;
}) {
  return SHELF;
}

export function useOlderSettledShelfGrowth(
  _shelf: typeof SHELF,
  _listed: ReadonlyArray<EnvironmentThreadShell>,
): void {}

export function readUnloadedThreadCount(): number {
  return 0;
}
