// Adapted from T3 Code's client-runtime state/models.ts: the thread and project
// shells the sidebar, the header and the thread's details read. kuru code
// builds them from Unharnessed's sessions (see ../../kuru/shells.ts) instead
// of T3 Code's orchestration projection; fields with no Unharnessed meaning
// are gone.
import type {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "~/contracts";

export interface ModelSelection {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly options?: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }>;
}

export interface EnvironmentProject {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly defaultModelSelection: ModelSelection | null;
  readonly faviconPath?: string | null;
  /** T3 Code's project icon override. */
  readonly projectIcon?:
    | { readonly kind: "monogram"; readonly text: string; readonly color: import("~/contracts").ProjectIconColor }
    | { readonly kind: "emoji"; readonly emoji: string }
    | null;
  /** The repository its folder is a checkout of: projects of one repository group together. */
  readonly repositoryIdentity?: import("~/contracts").RepositoryIdentity | null;
  readonly scripts: ReadonlyArray<never>;
  readonly pinnedAt?: string | null;
  readonly archivedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Threads with no project: Unharnessed sessions started in the home folder. */
  readonly isScratch?: true;
  /** The folder is gone. */
  readonly missing?: boolean;
}

/** A run's status, as T3 Code names them; an Unharnessed turn is one run. */
export type OrchestrationV2RunStatus =
  | "preparing"
  | "queued"
  | "starting"
  | "running"
  | "waiting"
  | "completed"
  | "interrupted"
  | "failed"
  | "cancelled"
  | "rolled_back";

export interface ThreadRunSummary {
  readonly runId: RunId;
  readonly status: OrchestrationV2RunStatus;
  readonly requestedAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly assistantMessageId: MessageId | null;
  readonly turnEnded?: boolean;
}

export interface ThreadRuntimeSummary {
  readonly status: OrchestrationV2RunStatus | "idle";
  readonly activeRunId: RunId | null;
  readonly activityStartedAt?: string | null | undefined;
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerName: string | null;
  readonly lastError: string | null;
  readonly lastErrorClass?: string | null;
  readonly lastErrorCode?: string | null;
  readonly usageLimitResetAt?: string | null;
  readonly updatedAt: string;
}

export type ThreadStructureRuntime = Omit<ThreadRuntimeSummary, "updatedAt">;

export function threadRuntimeIsActive(runtime: ThreadStructureRuntime | null | undefined): boolean {
  return runtime !== null && runtime !== undefined && threadRunStatusIsActive(runtime.status);
}

export function threadRuntimeCanArchive(runtime: ThreadRuntimeSummary | null | undefined): boolean {
  if (runtime?.status === "queued") return runtime.activeRunId === null;
  return (
    runtime?.status !== "preparing" &&
    runtime?.status !== "starting" &&
    runtime?.status !== "running"
  );
}

function threadRunStatusIsActive(status: ThreadRuntimeSummary["status"]): boolean {
  return (
    status === "preparing" ||
    status === "queued" ||
    status === "starting" ||
    status === "running" ||
    status === "waiting"
  );
}

export type { ThreadLinkedPullRequest } from "~/contracts";
import type { ThreadLinkedPullRequest } from "~/contracts";

export interface EnvironmentThreadShell {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly modelSelection: ModelSelection;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly latestRun: ThreadRunSummary | null;
  readonly runtime: ThreadRuntimeSummary | null;
  readonly latestUserMessageAt: string | null;
  readonly latestUserAuthoredMessageAt?: string | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly pendingUserInputAt?: string | null;
  readonly providerInstanceHistory: ReadonlyArray<ProviderInstanceId>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly settledOverride: "settled" | "active" | null;
  readonly settledAt: string | null;
  readonly unsettledAt: string | null;
  readonly snoozedUntil: string | null;
  readonly snoozedAt: string | null;
  readonly pinnedAt: string | null;
  readonly autoSettleDisabledAt?: string | null;
  readonly pinOrderKey: string | null;
  readonly activeOrderKey: string | null;
  readonly linkedPullRequest?: ThreadLinkedPullRequest | null;
  readonly branchPullRequest?: ThreadLinkedPullRequest | null;
  readonly pullRequests: ReadonlyArray<import("~/contracts").ThreadPullRequestLink>;
  /** The thread's Unharnessed goal, while one is set. */
  readonly goal?: { readonly status: "active" | "paused" | "complete" } | null;
  readonly lastVisitedAt?: string | null;
  /** When the thread was last opened, for search ranking (T3 Code's server-tracked opens). */
  readonly opens?: import("~/contracts").OrchestrationV2ThreadOpens | null;
  readonly titleRegeneration?: { readonly requestId: string; readonly startedAt: string } | null;
  readonly deletedAt: string | null;
  // T3 Code's thread facets with no Unharnessed counterpart: they keep their
  // resting values (a top-level thread, the default mode, nothing pending),
  // so the copied sidebar logic reads them unchanged.
  readonly lineage: ThreadLineage;
  readonly interactionMode: "default" | "plan";
  readonly hasActionableProposedPlan: boolean;
  readonly pendingBackgroundTasks: ReadonlyArray<never>;
  readonly blockedOnThreadWait?: boolean;
  readonly pendingSubagentRequest?: PendingSubagentRequest | null;
  readonly pendingGuestMessageCount?: number;
}

/** Where a thread sits among others: Unharnessed threads are all top-level. */
export interface ThreadLineage {
  readonly relationshipToParent: null | "subagent" | "side_chat";
  readonly parentThreadId: ThreadId | null;
}

export const ROOT_THREAD_LINEAGE: ThreadLineage = { relationshipToParent: null, parentThreadId: null };

/** From T3 Code's session-logic.ts: the latest run ended and no run is active. */
export function isLatestRunSettled(
  latestRun: Pick<ThreadRunSummary, "runId" | "startedAt" | "completedAt" | "status"> | null,
  runtime: Pick<ThreadRuntimeSummary, "status" | "activeRunId"> | null,
): boolean {
  if (latestRun === null) return false;
  if (
    latestRun.status === "preparing" ||
    latestRun.status === "queued" ||
    latestRun.status === "starting" ||
    latestRun.status === "running" ||
    latestRun.status === "waiting"
  )
    return false;
  return runtime?.activeRunId !== latestRun.runId;
}

export type PendingSubagentRequest = "approval" | "user_input";

const THREAD_PROVIDER_STACK_LIMIT = 3;

export function resolveThreadProviderStack(
  thread: Pick<EnvironmentThreadShell, "providerInstanceHistory" | "modelSelection" | "runtime">,
): ReadonlyArray<ProviderInstanceId> {
  const current = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const previous = thread.providerInstanceHistory.filter((instanceId) => instanceId !== current);
  return [...previous.slice(-(THREAD_PROVIDER_STACK_LIMIT - 1)), current];
}

/**
 * Both shell and detail timers count from the activity-owning run's work
 * start, never last activity. A wake keeps the start of the work it continues.
 */
export function resolveThreadWorkingStartedAt(input: {
  readonly latestRun: Pick<
    ThreadRunSummary,
    "runId" | "startedAt" | "requestedAt" | "completedAt"
  > | null;
  readonly runtime: Pick<ThreadRuntimeSummary, "activeRunId" | "activityStartedAt"> | null;
}): string | null {
  const valid = (value: string | null | undefined) =>
    value != null && Number.isFinite(Date.parse(value)) ? value : null;
  if (input.runtime?.activityStartedAt !== undefined) return valid(input.runtime.activityStartedAt);
  const run = input.latestRun;
  if (run?.completedAt === null && run.runId === input.runtime?.activeRunId) {
    return valid(run.startedAt) ?? valid(run.requestedAt);
  }
  return null;
}

export function formatWorkingDurationLabel(elapsedMs: number): string {
  const seconds = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 1000)) : 0;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
