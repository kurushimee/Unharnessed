// T3 Code's client-runtime operations/commands.ts: the inputs of its thread and
// project commands. Its dispatch to a server is replaced by kuru code's
// (state/threads.ts), which turns each command into what Unharnessed takes.
import type {
  CommandId,
  ChatAttachment,
  MessageId,
  ModelSelection,
  NodeId,
  OrchestrationV2Command,
  OrchestrationV2CreationSource,
  PlanId,
  ProjectId,
  ProviderInteractionMode,
  RunId,
  RuntimeMode,
  ThreadId,
  UploadChatAttachment,
} from "~/contracts";

export interface CommandMetadata {
  readonly commandId?: CommandId;
  readonly createdAt?: string;
  readonly creationSource?: OrchestrationV2CreationSource;
}

export interface ThreadCommandInput extends CommandMetadata {
  readonly threadId: ThreadId;
}

export interface VisitThreadInput extends ThreadCommandInput {
  readonly visitedAt: string;
  /** Counts toward search frecency; `searchQuery` is the palette query that picked it. */
  readonly opened?: boolean;
  readonly searchQuery?: string;
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

export type StopThreadSessionInput = ThreadCommandInput;

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

