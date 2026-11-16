import type * as DateTime from "effect/DateTime";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentProject,
  EnvironmentThread,
  EnvironmentThreadShell,
  EnvironmentThreadStructure,
  ThreadStructureVisibleTurnItem,
} from "~/rt/state/shell";
import {
  EMPTY_THREAD_HISTORY_META,
  type EnvironmentThreadStatus,
  type ThreadHistoryMeta,
} from "~/rt/state/threads";
import { threadKey } from "~/rt/state/entities";
import type { ScopedProjectRef, ScopedThreadRef } from "~/contracts";
import type { EnvironmentId, OrchestrationV2ProjectedTurnItem } from "~/contracts";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry";
// kuru code: one environment, whose shells and projects come from its main process (kuru/shells.ts).
import { environmentProjects, shellsBootstrappedAtom } from "~/kuru/shells";
import { environmentServerConfigsAtom } from "./server";
import { environmentThreadDetails, environmentThreadShells } from "./threads";
const allEnvironmentProjectSnapshotsReadyAtom = shellsBootstrappedAtom;
const allEnvironmentShellsBootstrappedAtom = shellsBootstrappedAtom;
const environmentPresentations = { serverConfigsAtom: environmentServerConfigsAtom };
import { waitForAtomValue } from "./waitForAtomValue";

const EMPTY_THREAD_REFS: ReadonlyArray<ScopedThreadRef> = Object.freeze([]);
const EMPTY_VISIBLE_TURN_ITEMS: ReadonlyArray<OrchestrationV2ProjectedTurnItem> = Object.freeze([]);

const EMPTY_PROJECT_ATOM = Atom.make<EnvironmentProject | null>(null).pipe(
  Atom.withLabel("web-project:empty"),
);
const EMPTY_THREAD_REFS_ATOM = Atom.make(EMPTY_THREAD_REFS).pipe(
  Atom.withLabel("web-thread-refs:empty"),
);
const EMPTY_THREAD_SHELLS_ATOM = Atom.make<ReadonlyArray<EnvironmentThreadShell>>(
  Object.freeze([]),
).pipe(Atom.withLabel("web-thread-shells:empty"));
const EMPTY_THREAD_SHELL_ATOM = Atom.make<EnvironmentThreadShell | null>(null).pipe(
  Atom.withLabel("web-thread-shell:empty"),
);
const EMPTY_THREAD_PROJECTION_ATOM = Atom.make<EnvironmentThread | null>(null).pipe(
  Atom.withLabel("web-thread-projection:empty"),
);
const EMPTY_THREAD_STATUS_ATOM = Atom.make<EnvironmentThreadStatus>("empty").pipe(
  Atom.withLabel("web-thread-status:empty"),
);
const EMPTY_VISIBLE_TURN_ITEMS_ATOM = Atom.make(EMPTY_VISIBLE_TURN_ITEMS).pipe(
  Atom.withLabel("web-thread-visible-turn-items:empty"),
);
const EMPTY_ASSISTANT_MESSAGE_TEXT_ATOM = Atom.make<string | null>(null).pipe(
  Atom.withLabel("web-assistant-message-text:empty"),
);
const EMPTY_LAST_VISITED_AT_ATOM = Atom.make<DateTime.Utc | null>(null).pipe(
  Atom.withLabel("web-thread-last-visited:empty"),
);
const EMPTY_UPDATED_AT_ATOM = Atom.make<DateTime.Utc | null>(null).pipe(
  Atom.withLabel("web-thread-updated-at:empty"),
);
const EMPTY_THREAD_HISTORY_ATOM = Atom.make<ThreadHistoryMeta>(EMPTY_THREAD_HISTORY_META).pipe(
  Atom.withLabel("web-thread-history:empty"),
);

export function useThreadRefs(enabled = true): ReadonlyArray<ScopedThreadRef> {
  return useAtomValue(enabled ? environmentThreadShells.threadRefsAtom : EMPTY_THREAD_REFS_ATOM);
}

export function useEnvironmentThreadRefs(
  environmentId: EnvironmentId | null,
): ReadonlyArray<ScopedThreadRef> {
  return useAtomValue(
    environmentId === null
      ? EMPTY_THREAD_REFS_ATOM
      : environmentThreadShells.environmentThreadRefsAtom(environmentId),
  );
}

export function useProjects(): ReadonlyArray<EnvironmentProject> {
  return useAtomValue(environmentProjects.projectsAtom);
}

/** Providers are left out; read them with `useEnvironmentProviders()`. */
export function useServerConfigs() {
  return useAtomValue(environmentPresentations.serverConfigsAtom);
}

export function useThreadShells(enabled = true): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(
    enabled ? environmentThreadShells.threadShellsAtom : EMPTY_THREAD_SHELLS_ATOM,
  );
}

/** Whether any connected environment is hiding tagged threads right now. */
export function useAnyEnvironmentHiding(): boolean {
  return useAtomValue(environmentThreadShells.anyEnvironmentHidingAtom);
}

/** Keys of threads the tag filter hides from display, by `threadKey`. */
export function useHiddenThreadKeys(): ReadonlySet<string> {
  return useAtomValue(environmentThreadShells.hiddenThreadKeysAtom);
}

/** Thread shells minus those the tag filter hides, for lists that show threads to the user. */
export function useVisibleThreadShells(enabled = true): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(
    enabled ? environmentThreadShells.visibleThreadShellsAtom : EMPTY_THREAD_SHELLS_ATOM,
  );
}

export function useAllEnvironmentShellsBootstrapped(): boolean {
  return useAtomValue(allEnvironmentShellsBootstrappedAtom);
}

export function useAllEnvironmentProjectSnapshotsReady(): boolean {
  return useAtomValue(allEnvironmentProjectSnapshotsReadyAtom);
}

/** Tasks linked environments run for a listed thread, by thread key; lists show them under it. */
export function useDelegatedUnderParent(): ReadonlySet<string> {
  return useAtomValue(environmentThreadShells.delegatedUnderParentAtom);
}

export function useProject(ref: ScopedProjectRef | null): EnvironmentProject | null {
  return useAtomValue(ref === null ? EMPTY_PROJECT_ATOM : environmentProjects.projectAtom(ref));
}

export function useThreadShell(ref: ScopedThreadRef | null): EnvironmentThreadShell | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_SHELL_ATOM : environmentThreadShells.threadShellAtom(ref),
  );
}

/** The shell without its streaming timestamps; see quietThreadShellAtom. */
export function useQuietThreadShell(ref: ScopedThreadRef | null): EnvironmentThreadShell | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_SHELL_ATOM : environmentThreadShells.quietThreadShellAtom(ref),
  );
}

/** Every thread shell, held through streaming ticks; see quietThreadShellAtom. */
export function useQuietThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(environmentThreadShells.quietThreadShellsAtom);
}

export function useChildThreadInputs(ref: ScopedThreadRef | null) {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_SHELLS_ATOM : environmentThreadShells.childThreadInputsAtom(ref),
  );
}

export function useThreadProjection(ref: ScopedThreadRef | null): EnvironmentThread | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_PROJECTION_ATOM : environmentThreadDetails.threadAtom(ref),
  );
}

/** The thread's structure, held through streamed assistant and reasoning text; see ThreadStructure. */
export function useQuietThreadProjection(
  ref: ScopedThreadRef | null,
): EnvironmentThreadStructure | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_PROJECTION_ATOM : environmentThreadDetails.quietThreadAtom(ref),
  );
}

/** The detail's live visit mark, which the thread structure leaves out. */
export function useThreadLastVisitedAt(ref: ScopedThreadRef | null): DateTime.Utc | null {
  return useAtomValue(
    ref === null ? EMPTY_LAST_VISITED_AT_ATOM : environmentThreadDetails.lastVisitedAtAtom(ref),
  );
}

/** The detail's live `updatedAt`, which the thread structure leaves out. */
export function useThreadUpdatedAt(ref: ScopedThreadRef | null): DateTime.Utc | null {
  return useAtomValue(
    ref === null ? EMPTY_UPDATED_AT_ATOM : environmentThreadDetails.updatedAtAtom(ref),
  );
}

export function useThreadStatus(ref: ScopedThreadRef | null): EnvironmentThreadStatus {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_STATUS_ATOM : environmentThreadDetails.statusAtom(ref),
  );
}

export function useThreadHistory(ref: ScopedThreadRef | null): ThreadHistoryMeta {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_HISTORY_ATOM : environmentThreadDetails.historyAtom(ref),
  );
}

export function resolveThreadDetailRef(
  ref: ScopedThreadRef | null,
  options: {
    shellExists: boolean;
    waitForShell: boolean;
  },
): ScopedThreadRef | null {
  return ref !== null && (!options.waitForShell || options.shellExists) ? ref : null;
}

/** Visible turn items held through streamed assistant text; see useAssistantMessageText. */
export function useTimelineVisibleTurnItems(
  ref: ScopedThreadRef | null,
): ReadonlyArray<OrchestrationV2ProjectedTurnItem> {
  return useAtomValue(
    ref === null
      ? EMPTY_VISIBLE_TURN_ITEMS_ATOM
      : environmentThreadDetails.timelineVisibleTurnItemsAtom(ref),
  );
}

/** One assistant message's live text, or null when the thread does not hold the item. */
export function useAssistantMessageText(
  ref: ScopedThreadRef | null,
  itemId: string | undefined,
): string | null {
  return useAtomValue(
    ref === null || itemId === undefined
      ? EMPTY_ASSISTANT_MESSAGE_TEXT_ATOM
      : environmentThreadDetails.assistantMessageTextAtom(ref, itemId),
  );
}

/** Visible turn items without their streamed text; see ThreadStructure. */
export function useQuietThreadVisibleTurnItems(
  ref: ScopedThreadRef | null,
): ReadonlyArray<ThreadStructureVisibleTurnItem> {
  return useAtomValue(
    ref === null
      ? EMPTY_VISIBLE_TURN_ITEMS_ATOM
      : environmentThreadDetails.quietVisibleTurnItemsAtom(ref),
  );
}

export function readProject(ref: ScopedProjectRef): EnvironmentProject | null {
  return appAtomRegistry.get(environmentProjects.projectAtom(ref));
}

export function readProjects(): ReadonlyArray<EnvironmentProject> {
  return appAtomRegistry.get(environmentProjects.projectsAtom);
}

export function waitForProject(
  ref: ScopedProjectRef,
  timeoutMs = 10_000,
): Promise<EnvironmentProject> {
  const current = readProject(ref);
  if (current !== null) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    const timeout = setTimeout(() => {
      unsubscribe?.();
      reject(new Error("The project did not appear in the desktop app."));
    }, timeoutMs);
    const finish = (project: EnvironmentProject | null) => {
      if (project === null) return;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(project);
    };
    unsubscribe = appAtomRegistry.subscribe(environmentProjects.projectAtom(ref), finish);
    finish(readProject(ref));
  });
}

export function readThreadShell(ref: ScopedThreadRef): EnvironmentThreadShell | null {
  return appAtomRegistry.get(environmentThreadShells.threadShellAtom(ref));
}

export function waitForThreadShell(ref: ScopedThreadRef, timeoutMs = 5_000): Promise<boolean> {
  return waitForAtomValue({
    registry: appAtomRegistry,
    atom: environmentThreadShells.threadShellAtom(ref),
    predicate: (thread) => thread !== null,
    timeoutMs,
  });
}

export function readEnvironmentServerConfigLoaded(environmentId: EnvironmentId): boolean {
  return appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId);
}

export function readEnvironmentSupportsAutoSettleOptOut(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadAutoSettleOptOut === true
  );
}

