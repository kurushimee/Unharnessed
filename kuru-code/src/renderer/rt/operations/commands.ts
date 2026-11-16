// T3 Code's client-runtime operations/commands.ts: the inputs of its thread and
// project commands. Its dispatch to a server is replaced by kuru code's
// (state/threads.ts), which turns each command into what Unharnessed takes.
import type {
  ThreadLinkedPullRequest,
  CommandId,
  ChatAttachment,
  MessageId,
  ModelSelection,
  NodeId,
  OrchestrationV2Command,
  OrchestrationV2CreationSource,
  PlanId,
  ProjectId,
  ProjectIconOverride,
  ProjectScript,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ProviderUserInputAnswers,
  RunId,
  RuntimeMode,
  RuntimeRequestId,
  ThreadId,
  ThreadEnvMode,
  UploadChatAttachment,
  GuestMessageId,
} from "~/contracts";

export interface CommandMetadata {
  readonly commandId?: CommandId;
  readonly createdAt?: string;
  readonly creationSource?: OrchestrationV2CreationSource;
}

export interface CreateProjectInput extends CommandMetadata {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly createWorkspaceRootIfMissing?: boolean;
  readonly defaultModelSelection?: ModelSelection | null;
  readonly scripts?: ReadonlyArray<ProjectScript>;
}

export interface UpdateProjectInput extends CommandMetadata {
  readonly projectId: ProjectId;
  readonly title?: string;
  readonly workspaceRoot?: string;
  readonly defaultModelSelection?: ModelSelection | null;
  readonly autoPull?: boolean;
  readonly projectIcon?: ProjectIconOverride | null;
  readonly faviconPath?: string | null;
  readonly defaultThreadEnvMode?: ThreadEnvMode | null;
  readonly scripts?: ReadonlyArray<ProjectScript>;
  readonly pinned?: boolean;
  readonly archived?: boolean;
}

export interface DeleteProjectInput extends CommandMetadata {
  readonly projectId: ProjectId;
  readonly force?: boolean;
}

export interface CreateThreadInput extends CommandMetadata {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly branch: string | null;
  readonly worktreePath: string | null;
}

export interface ThreadCommandInput extends CommandMetadata {
  readonly threadId: ThreadId;
}

export interface DeleteThreadInput extends ThreadCommandInput {
  /** The server deletes only a thread with no runs and no messages. */
  readonly onlyIfUnused?: boolean;
}

export type ArchiveThreadInput = ThreadCommandInput;

export type UnarchiveThreadInput = ThreadCommandInput;

export type SettleThreadInput = ThreadCommandInput;

export interface UnsettleThreadInput extends ThreadCommandInput {
  readonly reason: "user";
}

export interface PinThreadInput extends ThreadCommandInput {
  readonly orderKey?: string;
}

export type UnpinThreadInput = ThreadCommandInput;

export interface ReorderPinnedThreadInput extends ThreadCommandInput {
  readonly orderKey: string;
}

export interface ReorderActiveThreadInput extends ThreadCommandInput {
  readonly orderKey: string;
}

export interface SnoozeThreadInput extends ThreadCommandInput {
  readonly snoozedUntil: string;
}

export interface UnsnoozeThreadInput extends ThreadCommandInput {
  readonly reason: "user";
}

export interface VisitThreadInput extends ThreadCommandInput {
  readonly visitedAt: string;
  /** Counts toward search frecency; `searchQuery` is the palette query that picked it. */
  readonly opened?: boolean;
  readonly searchQuery?: string;
}

export type MarkThreadUnreadInput = ThreadCommandInput;

export interface UpdateThreadMetadataInput extends ThreadCommandInput {
  readonly limitRecovery?: import("~/contracts").OrchestrationV2LimitRecoveryUpdate | null;
  readonly title?: string;
  readonly modelSelection?: ModelSelection;
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly regenerateTitle?: boolean;
  readonly linkedPullRequest?: ThreadLinkedPullRequest | null;
  readonly expectedEmpty?: boolean;
}

export interface SetThreadRuntimeModeInput extends ThreadCommandInput {
  readonly runtimeMode: RuntimeMode;
}

export interface SetThreadInteractionModeInput extends ThreadCommandInput {
  readonly interactionMode: ProviderInteractionMode;
}

export interface StartThreadBootstrap {
  readonly createThread?: {
    readonly projectId: ProjectId;
    readonly title: string;
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ProviderInteractionMode;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly createdAt: string;
  };
  readonly prepareWorktree?: {
    readonly requireWorktree?: boolean;
    readonly projectCwd: string;
    readonly baseBranch: string;
    readonly branch?: string;
    readonly startFromOrigin?: boolean;
  };
  readonly runSetupScript?: boolean;
}

export interface StartThreadTurnInput extends ThreadCommandInput {
  readonly manualContinuationOfRunId?: RunId;
  readonly message: {
    readonly messageId: MessageId;
    readonly role: "user";
    readonly text: string;
    readonly attachments: ReadonlyArray<ChatAttachment | UploadChatAttachment>;
    readonly context?: import("~/contracts").OrchestrationMessageContext;
    readonly idleCompaction?: import("~/contracts").OrchestrationV2IdleCompaction;
  };
  readonly modelSelection?: ModelSelection;
  readonly titleSeed?: string;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly bootstrap?: StartThreadBootstrap;
  readonly sourceProposedPlan?: { readonly threadId: ThreadId; readonly planId: PlanId };
  readonly dispatchMode?: "auto" | "queue" | "steer" | "restart" | "start";
  /** Start a new provider session; needs the server's `freshContext` capability. */
  readonly freshContext?: boolean;
}

export interface InterruptThreadTurnInput extends ThreadCommandInput {
  readonly runId?: RunId;
  readonly subagentId?: NodeId;
  readonly turnId?: string;
}

export interface RespondToThreadApprovalInput extends ThreadCommandInput {
  readonly requestId: RuntimeRequestId;
  readonly decision: ProviderApprovalDecision;
  readonly feedback?: string;
}

export interface RespondToThreadUserInputInput extends ThreadCommandInput {
  readonly requestId: RuntimeRequestId;
  readonly answers: ProviderUserInputAnswers;
  readonly attachmentsByQuestionId?: import("~/contracts").UserInputAttachments;
}

export interface DismissThreadUserInputInput extends ThreadCommandInput {
  readonly requestId: RuntimeRequestId;
}

export interface RevertThreadCheckpointInput extends ThreadCommandInput {
  readonly restoreFiles?: boolean;
  readonly checkpointId?: string;
  readonly scopeId?: string;
  readonly turnCount?: number;
}

export type StopThreadSessionInput = ThreadCommandInput;

export interface ForkThreadFromRunInput extends CommandMetadata {
  readonly sourceThreadId: ThreadId;
  readonly targetThreadId: ThreadId;
  readonly runId: RunId;
  readonly title?: string;
}

export interface ForkSideChatInput extends CommandMetadata {
  readonly sourceThreadId: ThreadId;
  readonly targetThreadId: ThreadId;
  readonly title?: string;
}

export interface MergeThreadBackInput extends CommandMetadata {
  readonly sourceThreadId: ThreadId;
  readonly targetThreadId: ThreadId;
  readonly runId: RunId;
}

export interface ResumeThreadQueueInput extends ThreadCommandInput {
  readonly runId?: RunId;
}

export interface PromoteQueuedRunInput extends ThreadCommandInput {
  readonly queuedRunId: RunId;
  readonly targetRunId: RunId;
}

export interface CancelQueuedRunInput extends ThreadCommandInput {
  readonly runId: RunId;
}

export interface RetryWorkspacePreparationInput extends ThreadCommandInput {
  readonly runId: RunId;
}

export interface EditQueuedRunInput extends ThreadCommandInput {
  readonly runId: RunId;
  readonly text: string;
  /**
   * Full replacement attachment list for the queued message. Omitted =
   * text-only edit that leaves attachments untouched.
   */
  readonly edit?: {
    readonly messageId: MessageId;
    readonly attachments: ReadonlyArray<ChatAttachment | UploadChatAttachment>;
    readonly context?: import("~/contracts").OrchestrationMessageContext;
  };
}

export type CloseGuestShareInput = ThreadCommandInput;

export interface ResolveGuestMessageInput extends ThreadCommandInput {
  readonly guestMessageId: GuestMessageId;
  readonly decision: "send" | "dismiss";
  readonly creationSource?: "web" | "mobile";
}

export interface SetThreadAutoSettleInput extends ThreadCommandInput {
  readonly enabled: boolean;
}

export type LinkThreadPullRequestInput = Omit<
  Extract<OrchestrationV2Command, { type: "thread.pull-request.link" }>,
  "type" | "commandId"
> &
  CommandMetadata;

export type UnlinkThreadPullRequestInput = Omit<
  Extract<OrchestrationV2Command, { type: "thread.pull-request.unlink" }>,
  "type" | "commandId"
> &
  CommandMetadata;

export type WatchThreadPullRequestInput = Omit<
  Extract<OrchestrationV2Command, { type: "thread.pull-request.watch" }>,
  "type" | "commandId"
> &
  CommandMetadata;
