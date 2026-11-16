// T3 Code's thread details (client-runtime state/threadDetails), for kuru
// code: the projection of each thread T3 Code's thread view reads, as atoms.
// kuru code's main process streams the conversation on screen (the VS Code
// extension's chat, ~/state.ts); kuru/projection.ts makes it T3 Code's
// projection. A thread not on screen has none until it is opened. T3 Code's
// own thread detail atoms (rt/state/threadDetail.ts) derive the rest from it.
import { LOCAL_ENVIRONMENT_ID, ThreadId, type ScopedThreadRef } from "~/contracts";
import type { EnvironmentThread } from "~/rt/state/models";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useStore, type Store } from "~/state";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { createEnvironmentThreadDetailAtoms } from "~/rt/state/threadDetail";
import { threadKey } from "~/rt/state/entities";
import type { EnvironmentThreadState } from "~/rt/state/threadState";
import { EMPTY_THREAD_HISTORY_META } from "~/rt/state/threadHistoryMerge";

import { ThreadProjector, type ThreadProjectionSource } from "./projection";
import { readShells } from "./shells";


/** The shown thread's projection, by its key. */
const detailsAtom = Atom.make<ReadonlyMap<string, EnvironmentThread>>(new Map()).pipe(
  Atom.keepAlive,
  Atom.withLabel("kuru:thread-details"),
);

const projectors = new Map<string, ThreadProjector>();
/** When each turn of each thread began, as seen here, ms: Unharnessed's replay has no times. */
const turnTimes = new Map<string, Map<number, number>>();
let sources = new Map<string, ThreadProjectionSource>();

function sourceFor(state: Store, threadId: string): ThreadProjectionSource | null {
  const shell = readShells().threadByKey.get(`${LOCAL_ENVIRONMENT_ID}:${threadId}`);
  const row = state.app?.threads.find((candidate) => candidate.id === threadId);
  const times = turnTimes.get(threadId) ?? new Map<number, number>();
  turnTimes.set(threadId, times);
  const now = Date.now();
  for (const entry of state.chat.entries) {
    if (entry.kind === "turn" && entry.state === "running" && !times.has(entry.id)) times.set(entry.id, now);
  }
  const previous = sources.get(threadId);
  const next: ThreadProjectionSource = {
    threadId: ThreadId.make(threadId),
    projectId: shell?.projectId ?? (previous?.projectId as ThreadProjectionSource["projectId"]),
    title: shell?.title ?? row?.title ?? "New thread",
    provider: row?.provider ?? null,
    model: row?.model ?? null,
    branch: row?.branch ?? null,
    createdAt: row?.created ?? now,
    updatedAt: row?.updated ?? now,
    turnTimes: times,
  };
  // The same source keeps the projection when only the conversation changed.
  if (
    previous &&
    previous.projectId === next.projectId &&
    previous.title === next.title &&
    previous.provider === next.provider &&
    previous.model === next.model &&
    previous.branch === next.branch &&
    previous.createdAt === next.createdAt &&
    previous.turnTimes.size === times.size
  ) {
    return previous;
  }
  return next;
}

function update(state: Store): void {
  const threadId = state.app?.shown.id;
  const current = appAtomRegistry.get(detailsAtom);
  if (!threadId || state.app?.shown.draft) {
    if (current.size > 0) appAtomRegistry.set(detailsAtom, new Map());
    return;
  }
  const source = sourceFor(state, threadId);
  if (source === null) return;
  sources = new Map([[threadId, source]]);
  let projector = projectors.get(threadId);
  if (!projector) {
    projector = new ThreadProjector();
    projectors.clear();
    projectors.set(threadId, projector);
  }
  const projection = projector.project(state.chat, source);
  const key = threadKey({ environmentId: LOCAL_ENVIRONMENT_ID, threadId: ThreadId.make(threadId) });
  if (current.get(key)?.projection === projection) return;
  appAtomRegistry.set(detailsAtom, new Map([[key, { environmentId: LOCAL_ENVIRONMENT_ID, projection }]]));
}

let started = false;
/** Keeps the projections up with the conversation, for the window's life. */
export function startThreadDetails(): void {
  if (started) return;
  started = true;
  update(useStore.getState());
  useStore.subscribe((state, previous) => {
    if (state.chat !== previous.chat || state.app !== previous.app) update(state);
  });
}

/** The thread's state as T3 Code's thread detail atoms read it: live while on screen. */
export const threadStateFamily = Atom.family((key: string) =>
  Atom.make((get): AsyncResult.AsyncResult<EnvironmentThreadState, never> => {
    const thread = get(detailsAtom).get(key);
    return AsyncResult.success({
      data: Option.fromNullishOr(thread?.projection),
      status: thread ? "live" : "empty",
      error: Option.none(),
      history: EMPTY_THREAD_HISTORY_META,
      sequence: thread?.projection.turnItems.length ?? 0,
    });
  }).pipe(Atom.withLabel(`kuru:thread-state:${key}`)),
);

export const environmentThreadDetails = createEnvironmentThreadDetailAtoms((environmentId, threadId) =>
  threadStateFamily(threadKey({ environmentId, threadId })),
);
