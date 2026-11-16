// Adapted from T3 Code's client-runtime state/filesystem.ts: the folder
// browser's path logic. T3 Code reads folders through its server's RPC;
// kuru code asks its main process (state/filesystem.ts).
import type { FilesystemBrowseEntry } from "~/contracts";
import type { EnvironmentConnectionPhase } from "~/kuru/environment";
import {
  canNavigateUp,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  hasTrailingPathSeparator,
  isFilesystemBrowseQuery,
} from "./projects";


export function getFilesystemBrowsePath(query: string, platform = "", enabled = true) {
  const isBrowsing = enabled && isFilesystemBrowseQuery(query, platform);
  const directoryPath = isBrowsing ? getBrowseDirectoryPath(query) : "";
  const filterQuery =
    isBrowsing && !hasTrailingPathSeparator(query) ? getBrowseLeafPathSegment(query) : "";
  const parentPath = isBrowsing ? getBrowseParentPath(directoryPath) : null;

  return {
    isBrowsing,
    directoryPath,
    filterQuery,
    parentPath,
    canBrowseUp: isBrowsing && canNavigateUp(directoryPath),
  };
}

export function filterFilesystemBrowseEntries(
  entries: ReadonlyArray<FilesystemBrowseEntry>,
  query: string,
) {
  const lowerQuery = query.toLowerCase();
  const showHidden = query.startsWith(".");
  const visibleEntries = entries.filter(
    (entry) =>
      entry.name.toLowerCase().startsWith(lowerQuery) &&
      (showHidden || !entry.name.startsWith(".")),
  );
  const exactEntry =
    query.length > 0 ? (visibleEntries.find((entry) => entry.name === query) ?? null) : null;

  return { visibleEntries, exactEntry };
}

/** Shell-style Tab: a single match enters the directory, several extend to their common prefix. */
export function getFilesystemBrowseTabCompletion(
  visibleEntries: ReadonlyArray<FilesystemBrowseEntry>,
  filterQuery: string,
): { readonly name: string; readonly isComplete: boolean } | null {
  const [first, ...rest] = visibleEntries;
  if (first === undefined) return null;
  if (rest.length === 0) return { name: first.name, isComplete: true };
  let prefix = Array.from(first.name);
  for (const entry of rest) {
    const characters = Array.from(entry.name);
    let length = 0;
    while (
      length < prefix.length &&
      prefix[length]?.toLowerCase() === characters[length]?.toLowerCase()
    )
      length += 1;
    prefix = prefix.slice(0, length);
  }
  const name = prefix.join("");
  const lowerName = name.toLowerCase();
  return lowerName.length > filterQuery.toLowerCase().length &&
    visibleEntries.every((entry) => entry.name.toLowerCase().startsWith(lowerName))
    ? { name, isComplete: false }
    : null;
}

export function createBrowseNavigationCoordinator() {
  let generation = 0;

  return {
    invalidate: () => {
      generation += 1;
    },
    run: async (load: () => Promise<void>, commit: () => void) => {
      const navigationGeneration = ++generation;
      await load();
      if (navigationGeneration !== generation) {
        return false;
      }
      commit();
      return true;
    },
  };
}

export function canPreloadBrowsePath(
  connectionPhase: EnvironmentConnectionPhase | null | undefined,
): boolean {
  return connectionPhase === "connected";
}
