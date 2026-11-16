// T3 Code's state/projects.ts, the part the thread view reads: a project's
// files, answered by kuru code's main process, and their metadata, as T3
// Code's file chips ask it (one path at a time, kept a while).
import { LOCAL_ENVIRONMENT_ID, WS_METHODS, type EnvironmentId, type ScopedThreadRef, type ThreadId } from "~/contracts";
import { createLocalCommand, createLocalRpcCommand, createLocalRpcQueryAtomFamily } from "~/rt/state/runtime";
import { request } from "~/rt/rpc/client";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/reactivity";

const METADATA_TTL_MS = 30_000;

interface FileMetadataTarget {
  readonly environmentId: EnvironmentId;
  readonly input: { readonly path: string; readonly threadId?: ThreadId };
}

const metadataByPath = new Map<string, Set<Atom.Atom<unknown>>>();
const metadataFamily = Atom.family((key: string) => {
  const { input } = JSON.parse(key) as FileMetadataTarget;
  const atom = Atom.make(
    request(WS_METHODS.filesystemGetMetadata, { paths: [input.path] }).pipe(
      Effect.map((result) => result.entries[0] ?? null),
    ),
  ).pipe(Atom.setIdleTTL(METADATA_TTL_MS), Atom.withLabel(`environment-data:filesystem:metadata:${key}`));
  let atoms = metadataByPath.get(input.path);
  if (!atoms) metadataByPath.set(input.path, (atoms = new Set()));
  atoms.add(atom);
  return atom;
});

const NO_RETENTION = Atom.make(null);

export const projectEnvironment = {
  fileMetadata: (target: FileMetadataTarget) =>
    metadataFamily(
      JSON.stringify({
        environmentId: target.environmentId,
        input: { path: target.input.path },
      }),
    ),
  /** T3 Code keeps a thread's file metadata while it is open; kuru code's is kept by time. */
  fileMetadataThread: (_ref: ScopedThreadRef) => NO_RETENTION,
  invalidateFileMetadata: createLocalCommand({
    label: "environment-data:filesystem:invalidate-metadata",
    execute: async (target: { environmentId: EnvironmentId; input: { paths: ReadonlyArray<string> } }, registry: AtomRegistry.AtomRegistry) => {
      for (const path of new Set(target.input.paths)) {
        for (const atom of metadataByPath.get(path) ?? []) registry.refresh(atom);
      }
    },
  }),
  searchEntries: createLocalRpcQueryAtomFamily({
    label: "environment-data:projects:search-entries",
    tag: WS_METHODS.projectsSearchEntries,
    staleTimeMs: 15_000,
  }),
  listEntries: createLocalRpcQueryAtomFamily({
    label: "environment-data:projects:list-entries",
    tag: WS_METHODS.projectsListEntries,
    staleTimeMs: 30_000,
    idleTtlMs: 5 * 60_000,
  }),
  readFile: createLocalRpcQueryAtomFamily({
    label: "environment-data:projects:read-file",
    tag: WS_METHODS.projectsReadFile,
    staleTimeMs: 30_000,
    idleTtlMs: 5 * 60_000,
  }),
  writeFile: createLocalRpcCommand({
    label: "environment-data:projects:write-file",
    tag: WS_METHODS.projectsWriteFile,
  }),
};

export const LOCAL_PROJECT_ENVIRONMENT_ID = LOCAL_ENVIRONMENT_ID;
