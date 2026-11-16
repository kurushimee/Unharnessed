// T3 Code's state/threads.ts: the thread commands its server takes, as kuru
// code runs them. Each becomes what Unharnessed takes through kuru code's
// main process: a message to a thread (main/threads.ts `send`), a stop, a
// session option (the model, its reasoning effort, its fast mode). A draft's
// thread is named before Unharnessed makes its session: the main process
// keeps the draft's id as the session's alias, so the thread keeps the id
// T3 Code's draft gave it. What Unharnessed has no equivalent for (approvals,
// checkpoints, forks, guest shares) fails with the reason.
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
  DismissThreadUserInputInput,
  EditQueuedRunInput,
  ForkSideChatInput,
  ForkThreadFromRunInput,
  InterruptThreadTurnInput,
  MergeThreadBackInput,
  PromoteQueuedRunInput,
  RespondToThreadApprovalInput,
  RespondToThreadUserInputInput,
  ResumeThreadQueueInput,
  RetryWorkspacePreparationInput,
  RevertThreadCheckpointInput,
  SetThreadInteractionModeInput,
  SetThreadRuntimeModeInput,
  StartThreadTurnInput,
  StopThreadSessionInput,
  VisitThreadInput,
  LinkThreadPullRequestInput,
  UnlinkThreadPullRequestInput,
  WatchThreadPullRequestInput,
} from "~/rt/operations/commands";
import { appProjectIdOf, readThreadShell } from "~/kuru/shells";
import { LOCAL_ENVIRONMENT_ID } from "~/contracts";

export interface ThreadMetadataUpdate {
  readonly environmentId: EnvironmentId;
  readonly input: {
    readonly threadId: ThreadId;
    readonly title?: string;
    readonly regenerateTitle?: boolean;
    readonly modelSelection?: ModelSelection;
    readonly [key: string]: unknown;
  };
}

export type OrchestrationCommand<I> = (input: I) => Promise<AtomCommandResult<unknown, unknown>>;

const updateMetadata = createLocalCommand({
  label: "kuru:thread:update-metadata",
  execute: async ({ input }: ThreadMetadataUpdate) => {
    if (input.regenerateTitle) throw new Error("Unharnessed has no title generator.");
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

function unsupported<I>(label: string, reason: string): AtomCommand<Target<I>, never, never> {
  return command<I, never>(label, () => {
    throw new Error(reason);
  });
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
  await invoke("threads.send", {
    id: input.threadId,
    projectId: projectId === null ? null : appProjectIdOf(projectId),
    text: input.message.text,
    images: toAttachments(input.message.attachments),
    now: input.dispatchMode === "steer",
  });
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

const NO_LINK = "kuru code finds a thread's pull request from its branch.";

export const threadEnvironment = {
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
  snooze: metaCommand<{ readonly threadId: ThreadId; readonly snoozedUntil: string }>("snooze", (input) => ({
    snoozedUntil: input.snoozedUntil,
    snoozedAt: new Date().toISOString(),
  })),
  unsnooze: metaCommand<{ readonly threadId: ThreadId }>("unsnooze", () => ({ snoozedUntil: null, snoozedAt: null })),
  archive: metaCommand<{ readonly threadId: ThreadId }>("archive", () => ({ archivedAt: Date.now() })),
  unarchive: metaCommand<{ readonly threadId: ThreadId }>("unarchive", () => ({ archivedAt: null })),
  markUnread: metaCommand<{ readonly threadId: ThreadId }>("mark-unread", () => ({ unread: true })),
  editQueuedRun: unsupported<EditQueuedRunInput>("edit-queued", "Unharnessed edits a waiting message in the composer."),
  respondToApproval: unsupported<RespondToThreadApprovalInput>("approval", "Unharnessed asks for no approvals."),
  respondToUserInput: unsupported<RespondToThreadUserInputInput>("user-input", "Unharnessed asks no questions."),
  dismissUserInput: unsupported<DismissThreadUserInputInput>("dismiss-user-input", "Unharnessed asks no questions."),
  revertCheckpoint: unsupported<RevertThreadCheckpointInput>("revert", "Unharnessed keeps no checkpoints."),
  forkFromRun: unsupported<ForkThreadFromRunInput>("fork", "Unharnessed does not fork threads."),
  forkSideChat: unsupported<ForkSideChatInput>("side-chat", "Unharnessed has no side chats."),
  mergeBack: unsupported<MergeThreadBackInput>("merge-back", "Unharnessed has no side chats."),
  retryWorkspacePreparation: unsupported<RetryWorkspacePreparationInput>("retry-workspace", "Unharnessed prepares no worktrees."),
  uploadFeedback: unsupported<unknown>("feedback", "Unharnessed takes no feedback uploads."),
  linkPullRequest: unsupported<LinkThreadPullRequestInput>("link-pull-request", NO_LINK),
  unlinkPullRequest: unsupported<UnlinkThreadPullRequestInput>("unlink-pull-request", NO_LINK),
  watchPullRequest: unsupported<WatchThreadPullRequestInput>("watch-pull-request", NO_LINK),
};

export { environmentThreadDetails } from "~/kuru/threadDetails";

export { environmentThreadShells } from "~/kuru/shells";

/** T3 Code's approvals its child threads wait on; Unharnessed asks for none. */
import { Atom } from "effect/reactivity";
import type { ChildThreadApproval } from "~/rt/state/threadRequests";
import type { ScopedThreadRef } from "~/contracts";
const NO_CHILD_APPROVALS = Atom.make<ReadonlyArray<ChildThreadApproval>>([]);
export const childThreadApprovalsAtom = (_ref: ScopedThreadRef | null) => NO_CHILD_APPROVALS;

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
