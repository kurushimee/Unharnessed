// T3 Code's state/threads.ts: the thread commands its server takes, as kuru
// code runs them. Each becomes what Unharnessed takes through kuru code's
// main process: a message to a thread (main/threads.ts `send`), a stop, a
// session option (the model, its reasoning effort, its fast mode). A draft's
// thread is named before Unharnessed makes its session: the main process
// keeps the draft's id as the session's alias, so the thread keeps the id
// T3 Code's draft gave it.
import type {
  EnvironmentId,
  ModelSelection,
  ThreadId,
  UploadChatAttachment,
  ChatAttachment,
} from "~/contracts";
import type { Attachment, ConfigChange } from "@shared/protocol";
import { invoke, post } from "~/bridge";
import { useStore } from "~/state";
import { createLocalCommand, type AtomCommand, type AtomCommandResult } from "~/rt/state/runtime";
import type {
  CancelQueuedRunInput,
  EditQueuedRunInput,
  InterruptThreadTurnInput,
  PromoteQueuedRunInput,
  ResumeThreadQueueInput,
  SetThreadInteractionModeInput,
  SetThreadRuntimeModeInput,
  StartThreadTurnInput,
  StopThreadSessionInput,
  VisitThreadInput,
  LinkThreadPullRequestInput,
  UnlinkThreadPullRequestInput,
} from "~/rt/operations/commands";
import { appProjectIdOf, readThreadShell, shellSnapshotAtom } from "~/kuru/shells";
import { forgetPromptSent, notePromptSent, queuedAttachmentId } from "~/kuru/projection";
import { LOCAL_ENVIRONMENT_ID } from "~/contracts";

export interface ThreadMetadataUpdate {
  readonly environmentId: EnvironmentId;
  readonly input: {
    readonly threadId: ThreadId;
    readonly title?: string;
    readonly modelSelection?: ModelSelection;
    readonly [key: string]: unknown;
  };
}

export type OrchestrationCommand<I> = (input: I) => Promise<AtomCommandResult<unknown, unknown>>;

const updateMetadata = createLocalCommand({
  label: "kuru:thread:update-metadata",
  execute: async ({ input }: ThreadMetadataUpdate) => {
    if (input.modelSelection) applyModelSelection(input.modelSelection);
    await invoke("threads.update", {
      id: input.threadId,
      change: input.title === undefined ? {} : { title: input.title },
    });
  },
});

/** From T3 Code's client-runtime threadHistoryController.ts. */
export type ThreadHistoryLoadEarlierResult =
  | { readonly _tag: "loaded" }
  | { readonly _tag: "noop" }
  | { readonly _tag: "busy" }
  | { readonly _tag: "error"; readonly message: string };

type Target<I> = { readonly environmentId: EnvironmentId; readonly input: I };

function command<I, A>(label: string, execute: (input: I) => Promise<A> | A): AtomCommand<Target<I>, A, never> {
  return createLocalCommand({ label: `kuru:thread:${label}`, execute: async (target: Target<I>) => execute(target.input) });
}

/** Whether the thread is the one kuru code's main process has on screen. */
function isShown(threadId: ThreadId): boolean {
  return useStore.getState().app?.shown.id === threadId;
}

/** A T3 Code model selection, as the shown session's options. */
export function applyModelSelection(selection: ModelSelection): void {
  const session = useStore.getState().session;
  if (session?.kind !== "open") return;
  const config = session.config;
  const changes: ConfigChange[] = [];
  const choice = config.model?.choices.find(
    (candidate) => candidate.id === selection.model && candidate.provider === selection.instanceId,
  ) ?? config.model?.choices.find((candidate) => candidate.id === selection.model);
  if (choice && choice.value !== config.model?.current) changes.push({ configId: "model", value: choice.value });
  for (const option of selection.options ?? []) {
    if (option.id === "thought_level" && typeof option.value === "string" && option.value !== config.effort?.current) {
      changes.push({ configId: "thought_level", value: option.value });
    }
    if (option.id === "fast_mode" && typeof option.value === "boolean" && option.value !== config.fast) {
      changes.push({ configId: "fast_mode", value: option.value });
    }
  }
  for (const change of changes) post({ type: "setConfig", ...change });
}

function dataUrlParts(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  return match ? { mimeType: match[1]!, data: match[2]! } : null;
}

/** The images a message carries, as Unharnessed takes them. */
function toAttachments(attachments: ReadonlyArray<ChatAttachment | UploadChatAttachment>): Attachment[] {
  return attachments.flatMap((attachment) => {
    if (!("dataUrl" in attachment)) return [];
    const parts = dataUrlParts(attachment.dataUrl);
    return parts ? [{ data: parts.data, mimeType: parts.mimeType, thumb: attachment.dataUrl, name: attachment.name }] : [];
  });
}

const startTurn = command<StartThreadTurnInput, { readonly sequence?: number }>("start-turn", async (input) => {
  if (input.modelSelection && isShown(input.threadId)) applyModelSelection(input.modelSelection);
  const created = input.bootstrap?.createThread;
  const shell = readThreadShell({ environmentId: LOCAL_ENVIRONMENT_ID, threadId: input.threadId });
  const projectId = created?.projectId ?? shell?.projectId ?? null;
  notePromptSent(input.threadId, input.message.messageId, input.message.text);
  try {
    await invoke("threads.send", {
      id: input.threadId,
      projectId: projectId === null ? null : appProjectIdOf(projectId),
      text: input.message.text,
      images: toAttachments(input.message.attachments),
      now: input.dispatchMode === "steer",
    });
  } catch (error) {
    forgetPromptSent(input.threadId, input.message.messageId);
    throw error;
  }
  return {};
});

const interruptTurn = command<InterruptThreadTurnInput, void>("interrupt", async (input) => {
  await invoke("threads.cancel", { id: input.threadId });
});

const stopSession = command<StopThreadSessionInput, void>("stop-session", async (input) => {
  await invoke("threads.cancel", { id: input.threadId });
});

const setModelSelection = command<{ readonly threadId: ThreadId; readonly modelSelection: ModelSelection }, void>(
  "set-model-selection",
  (input) => {
    if (isShown(input.threadId)) applyModelSelection(input.modelSelection);
  },
);

/** Unharnessed runs every thread in full access and has no plan mode: these change nothing. */
const setRuntimeMode = command<SetThreadRuntimeModeInput, void>("set-runtime-mode", () => undefined);
const setInteractionMode = command<SetThreadInteractionModeInput, void>("set-interaction-mode", () => undefined);

/** The thread's waiting messages, as kuru code's chat queues them (their ids are the queue's). */
function queuedId(runId: string): number | null {
  const match = /queued-(\d+)$/.exec(runId);
  return match ? Number(match[1]) : null;
}

const resumeThreadQueue = command<ResumeThreadQueueInput, void>("resume-queue", () => post({ type: "resumeQueue" }));
const cancelQueuedRun = command<CancelQueuedRunInput, void>("cancel-queued", (input) => {
  const id = queuedId(input.runId);
  if (id !== null) post({ type: "unqueue", id });
});
const promoteQueuedRun = command<PromoteQueuedRunInput, void>("promote-queued", (input) => {
  const id = queuedId(input.queuedRunId);
  if (id !== null) post({ type: "sendNow", id });
});

/** A waiting message changed in place: its images kept by position, new ones after them. */
const editQueuedRun = command<EditQueuedRunInput, void>("edit-queued", async (input) => {
  const id = queuedId(input.runId);
  if (id === null) throw new Error("This message is not waiting.");
  const prefix = queuedAttachmentId(input.threadId, id, 0).slice(0, -1);
  const attachments = input.edit?.attachments;
  const keep =
    attachments === undefined
      ? null
      : attachments.flatMap((attachment) =>
          !("dataUrl" in attachment) && attachment.id.startsWith(prefix)
            ? [Number(attachment.id.slice(prefix.length))]
            : [],
        );
  const changed = await invoke<boolean>("threads.editQueued", {
    id: input.threadId,
    message: id,
    text: input.text,
    // Omitted attachments leave the message's images as they were.
    keep: keep ?? (useStore.getState().chat.queue.find((queued) => queued.id === id)?.images.map((_, index) => index) ?? []),
    images: attachments === undefined ? [] : toAttachments(attachments),
  });
  if (!changed) throw new Error("The message is no longer waiting: it was sent or removed.");
});

/** A waiting message held while it is changed in the composer, or let go. */
export function holdQueuedRun(threadId: ThreadId, runId: string, hold: boolean): void {
  const id = queuedId(runId);
  if (id !== null) void invoke("threads.holdQueued", { id: threadId, message: id, hold });
}

const visit = command<VisitThreadInput, void>("visit", (input) => post({ type: "seen", id: input.threadId }));

/** kuru code has a thread's whole conversation: there is never earlier history to load. */
const loadEarlierHistory = createLocalCommand({
  label: "kuru:thread:load-earlier-history",
  execute: async (_target: {
    environmentId: EnvironmentId;
    input: { threadId: ThreadId; throughEntryId?: string; workAnchorId?: string };
  }): Promise<ThreadHistoryLoadEarlierResult> => ({ _tag: "noop" }),
});

function metaCommand<I extends { readonly threadId: ThreadId }>(
  label: string,
  change: (input: I) => Record<string, string | number | boolean | null>,
) {
  return command<I, void>(label, async (input) => {
    await invoke("threads.update", { id: input.threadId, change: change(input) });
  });
}

const deleteThread = command<{ readonly threadId: ThreadId; readonly onlyIfUnused?: boolean }, void>(
  "delete",
  async (input) => {
    const shell = readThreadShell({ environmentId: LOCAL_ENVIRONMENT_ID, threadId: input.threadId });
    // A thread with nothing sent in it has no session file: nothing to delete.
    if (input.onlyIfUnused && shell?.latestUserMessageAt) return;
    if (!shell) return;
    const error = await invoke<string | null>("threads.delete", { id: input.threadId });
    if (typeof error === "string") throw new Error(error);
  },
);

/** A pull request linked to a thread by hand, beside its branch's; the main process reads it from GitHub. */
const linkPullRequest = command<LinkThreadPullRequestInput, void>("link-pull-request", async (input) => {
  const error = await invoke<string | null>("threads.linkPullRequest", { id: input.threadId, url: input.url });
  if (error !== null) throw new Error(error);
});

/** A linked pull request, or the branch's, no longer shown on the thread. */
const unlinkPullRequest = command<UnlinkThreadPullRequestInput, void>("unlink-pull-request", async (input) => {
  await invoke("threads.unlinkPullRequest", {
    id: input.threadId,
    url: `https://${input.host}/${input.repository}/pull/${input.number}`,
  });
});

export const threadEnvironment = {
  snapshotAtom: shellSnapshotAtom,
  updateMetadata,
  loadEarlierHistory,
  startTurn,
  interruptTurn,
  stopSession,
  setModelSelection,
  setRuntimeMode,
  setInteractionMode,
  resumeThreadQueue,
  cancelQueuedRun,
  promoteQueuedRun,
  visit,
  delete: deleteThread,
  settle: metaCommand<{ readonly threadId: ThreadId }>("settle", () => ({ settledAt: Date.now(), pinnedAt: null })),
  unsettle: metaCommand<{ readonly threadId: ThreadId }>("unsettle", () => ({ settledAt: null, unsettledAt: Date.now() })),
  archive: metaCommand<{ readonly threadId: ThreadId }>("archive", () => ({ archivedAt: Date.now() })),
  unarchive: metaCommand<{ readonly threadId: ThreadId }>("unarchive", () => ({ archivedAt: null })),
  markUnread: metaCommand<{ readonly threadId: ThreadId }>("mark-unread", () => ({ unread: true })),
  editQueuedRun,
  linkPullRequest,
  unlinkPullRequest,
};

export { environmentThreadDetails } from "~/kuru/threadDetails";

export { environmentThreadShells } from "~/kuru/shells";


// T3 Code's thread state reads, over kuru code's projections (kuru/threadDetails.ts).
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { threadKey } from "~/rt/state/entities";
import { EMPTY_ENVIRONMENT_THREAD_STATE, type EnvironmentThreadState } from "~/rt/state/threadState";
import { threadStateFamily } from "~/kuru/threadDetails";
import { Atom as ThreadAtom } from "effect/reactivity";


const EMPTY_THREAD_STATE_ATOM = ThreadAtom.make(AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE));

export function useEnvironmentThread(environmentId: EnvironmentId | null, threadId: ThreadId | null): EnvironmentThreadState {
  const result = useAtomValue(
    environmentId !== null && threadId !== null ? threadStateFamily(threadKey({ environmentId, threadId })) : EMPTY_THREAD_STATE_ATOM,
  );
  return AsyncResult.getOrElse(result, () => EMPTY_ENVIRONMENT_THREAD_STATE);
}

/**
 * T3 Code's thread families: which threads' rows its server streams. kuru code's main process
 * lists every session, so there is nothing to mount.
 */
export const threadFamilies = {
  mount: (_registry: unknown, _environmentId: EnvironmentId, _threadId: ThreadId): (() => void) => () => {},
  mountRows: (_registry: unknown, _environmentId: EnvironmentId, _key: string, _rows: unknown): (() => void) => () => {},
};
