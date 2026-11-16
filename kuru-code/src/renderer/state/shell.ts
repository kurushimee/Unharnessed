// T3 Code's state/shell.ts, the part the thread view reads: opening a path in
// an editor, which kuru code's main process does (src/main/rpc.ts).
import { WS_METHODS } from "~/contracts";
import { createLocalRpcCommand } from "~/rt/state/runtime";

export const shellEnvironment = {
  openInEditor: createLocalRpcCommand({
    label: "environment-data:shell:open-in-editor",
    tag: WS_METHODS.shellOpenInEditor,
  }),
};

// T3 Code's shell status: its environment's shell is "live" once its server's
// first snapshot is in; kuru code's once the main process's first read of the
// sessions folder is.
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { LOCAL_ENVIRONMENT_ID, type EnvironmentId } from "~/contracts";
import { shellsBootstrappedAtom } from "~/kuru/shells";

export type EnvironmentShellStatus = "empty" | "cached" | "synchronizing" | "live";

const NO_SHELL_STATUS_ATOM = Atom.make<EnvironmentShellStatus | null>(null);
const localShellStatusAtom = Atom.make((get): EnvironmentShellStatus =>
  get(shellsBootstrappedAtom) ? "live" : "synchronizing",
).pipe(Atom.withLabel("kuru:shell-status"));

export const environmentShell = {
  statusAtom: (environmentId: EnvironmentId) =>
    environmentId === LOCAL_ENVIRONMENT_ID ? localShellStatusAtom : (NO_SHELL_STATUS_ATOM as Atom.Atom<EnvironmentShellStatus | null>),
};

export function useEnvironmentShellStatus(environmentId: EnvironmentId | null): EnvironmentShellStatus | null {
  return useAtomValue(environmentId === null ? NO_SHELL_STATUS_ATOM : environmentShell.statusAtom(environmentId));
}

export function useEnvironmentShellHasSnapshot(environmentId: EnvironmentId | null): boolean {
  return useEnvironmentShellStatus(environmentId) === "live";
}
