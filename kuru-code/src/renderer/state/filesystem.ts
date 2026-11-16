// T3 Code's state/filesystem.ts: file metadata from kuru code's main process,
// which may read every file of its own machine.
import { WS_METHODS, type EnvironmentId } from "~/contracts";
import { createLocalRpcQueryAtomFamily } from "~/rt/state/runtime";

export const filesystemEnvironment = {
  getMetadata: createLocalRpcQueryAtomFamily({
    label: "environment-data:filesystem:get-metadata",
    tag: WS_METHODS.filesystemGetMetadata,
  }),
  browse: createLocalRpcQueryAtomFamily({
    label: "environment-data:filesystem:browse",
    tag: WS_METHODS.filesystemBrowse,
    idleTtlMs: 5_000,
  }),
};

const READABLE = { canReadFiles: true, isPending: false, error: null } as const;

export function useFilesystemReadAccess(_environmentId: EnvironmentId | null) {
  return READABLE;
}
