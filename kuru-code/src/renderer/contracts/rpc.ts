import {
  OrchestrationV2SearchThreadError,
  OrchestrationV2SearchThreadInput,
  OrchestrationV2SearchThreadResult,
  OrchestrationV2SearchThreadsInput,
  OrchestrationV2SearchThreadsResult,
} from "./orchestrationV2";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import { NonNegativeInt } from "./baseSchemas";

import { EnvironmentAuthorizationError } from "./auth";
import {
  FilesystemGetMetadataInput,
  FilesystemGetMetadataResult,
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  FilesystemBrowseError,
} from "./filesystem";
import { AssetAccessError, AssetCreateUrlInput, AssetCreateUrlResult } from "./assets";
import { OrchestrationGetFullThreadDiffError, OrchestrationGetTurnDiffError } from "./checkpointDiff";
import {
  GitActionProgressEvent,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
  GitCommandError,
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  VcsPullInput,
  GitPullRequestRefInput,
  VcsPullResult,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  VcsStatusInput,
  VcsBranchStatus,
  VcsStatusSubscriptionInput,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "./git";
import { OrchestrationSearchThreadsError } from "./threadSearch";
import {
  PullRequestActionInput,
  PullRequestActivity,
  PullRequestChangeBreakdown,
  PullRequestCommentInput,
  PullRequestCommentUpdateInput,
  PullRequestDetail,
  PullRequestPreview,
  PullRequestChecks,
  PullRequestDiffFileContentsInput,
  PullRequestDiffFileContentsResult,
  PullRequestFilesViewedResult,
  PullRequestInvalidateInput,
  PullRequestListInput,
  PullRequestListResult,
  PullRequestListStatsInput,
  PullRequestListStatsResult,
  PullRequestFilterOptions,
  PullRequestFilterOptionsInput,
  PullRequestOperationError,
  PullRequestReactionInput,
  PullRequestRef,
  PullRequestStack,
  PullRequestLinkedThreadsResult,
  PullRequestSummary,
  PullRequestReviewerCandidateList,
  PullRequestReviewerCandidatesInput,
  PullRequestReviewerRequestInput,
  PullRequestLabelCandidateList,
  PullRequestLabelChangeInput,
  PullRequestSetFilesViewedInput,
  PullRequestSubmitReviewInput,
  PullRequestThreadCommentsInput,
  PullRequestThreadCommentsResult,
  PullRequestThreadReplyInput,
  PullRequestThreadResolutionInput,
  PullRequestUnavailableError,
  PullRequestUpdateInput,
} from "./pullRequest";
import {
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationGetWorkflowScriptError,
  OrchestrationV2GetNativeChildWorkError,
  OrchestrationV2StopWorkflowError,
  OrchestrationV2ForceStopThreadError,
  OrchestrationV2DispatchCommandError,
  OrchestrationV2GetShellSnapshotError,
  OrchestrationV2CommandOutputError,
  OrchestrationV2GetThreadProjectionError,
  OrchestrationV2RpcSchemas,
  OrchestrationV2ThreadLaunchError,
} from "./orchestrationV2";
import {
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import { UsagePricing, UsageReadError, UsageSummary, UsageSummaryInput } from "./usage";
import { VcsError } from "./vcs";

export const WS_METHODS = {
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  filesystemBrowse: "filesystem.browse",
  filesystemGetMetadata: "filesystem.getMetadata",
  assetsCreateUrl: "assets.createUrl",

  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsListRefs: "vcs.listRefs",
  vcsCreateRef: "vcs.createRef",
  vcsSwitchRef: "vcs.switchRef",
  vcsInit: "vcs.init",

  gitRunStackedAction: "git.runStackedAction",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  serverGetUsageSummary: "server.getUsageSummary",
  serverRefreshUsageRates: "server.refreshUsageRates",

  pullRequestsList: "pullRequests.list",
  pullRequestsListStats: "pullRequests.listStats",
  pullRequestsFilterOptions: "pullRequests.filterOptions",
  pullRequestsSummary: "pullRequests.summary",
  pullRequestsStack: "pullRequests.stack",
  pullRequestsLinkedThreads: "pullRequests.linkedThreads",
  pullRequestsDetail: "pullRequests.detail",
  pullRequestsPreview: "pullRequests.preview",
  pullRequestsChecks: "pullRequests.checks",
  pullRequestsActivity: "pullRequests.activity",
  pullRequestsThreadComments: "pullRequests.threadComments",
  pullRequestsDiffFileContents: "pullRequests.diffFileContents",
  pullRequestsFilesViewed: "pullRequests.filesViewed",
  pullRequestsChangeBreakdown: "pullRequests.changeBreakdown",
  pullRequestsSetFilesViewed: "pullRequests.setFilesViewed",
  pullRequestsRunAction: "pullRequests.runAction",
  pullRequestsUpdate: "pullRequests.update",
  pullRequestsComment: "pullRequests.comment",
  pullRequestsUpdateComment: "pullRequests.updateComment",
  pullRequestsSubmitReview: "pullRequests.submitReview",
  pullRequestsReplyToThread: "pullRequests.replyToThread",
  pullRequestsSetThreadResolution: "pullRequests.setThreadResolution",
  pullRequestsSetReaction: "pullRequests.setReaction",
  pullRequestsInvalidate: "pullRequests.invalidate",
  pullRequestsSubscribeRefreshes: "pullRequests.subscribeRefreshes",
  pullRequestsReviewerCandidates: "pullRequests.reviewerCandidates",
  pullRequestsRequestReviewers: "pullRequests.requestReviewers",
  pullRequestsLabelCandidates: "pullRequests.labelCandidates",
  pullRequestsSetLabels: "pullRequests.setLabels",

  subscribeVcsStatus: "subscribeVcsStatus",
  subscribeVcsBranch: "subscribeVcsBranch",
  vcsRefreshBranch: "vcs.refreshBranch",
} as const;

const WsServerGetUsageSummaryRpc = Rpc.make(WS_METHODS.serverGetUsageSummary, {
  payload: UsageSummaryInput,
  success: UsageSummary,
  error: Schema.Union([EnvironmentAuthorizationError, UsageReadError]),
});

const WsServerRefreshUsageRatesRpc = Rpc.make(WS_METHODS.serverRefreshUsageRates, {
  payload: Schema.Struct({}),
  success: UsagePricing,
  error: EnvironmentAuthorizationError,
});

const PullRequestRpcError = Schema.Union([
  PullRequestUnavailableError,
  PullRequestOperationError,
  EnvironmentAuthorizationError,
]);

const WsPullRequestsListRpc = Rpc.make(WS_METHODS.pullRequestsList, {
  payload: PullRequestListInput,
  success: PullRequestListResult,
  error: PullRequestRpcError,
});

// GitHub line counts cost 40-60% of the listing read; fetch separately so rows arrive first.
const WsPullRequestsListStatsRpc = Rpc.make(WS_METHODS.pullRequestsListStats, {
  payload: PullRequestListStatsInput,
  success: PullRequestListStatsResult,
  error: PullRequestRpcError,
});

const WsPullRequestsFilterOptionsRpc = Rpc.make(WS_METHODS.pullRequestsFilterOptions, {
  payload: PullRequestFilterOptionsInput,
  success: PullRequestFilterOptions,
  error: PullRequestRpcError,
});

const WsPullRequestsSummaryRpc = Rpc.make(WS_METHODS.pullRequestsSummary, {
  payload: PullRequestRef,
  success: PullRequestSummary,
  error: PullRequestRpcError,
});

const WsPullRequestsStackRpc = Rpc.make(WS_METHODS.pullRequestsStack, {
  payload: PullRequestRef,
  success: Schema.NullOr(PullRequestStack),
  error: PullRequestRpcError,
});

const WsPullRequestsLinkedThreadsRpc = Rpc.make(WS_METHODS.pullRequestsLinkedThreads, {
  payload: PullRequestRef,
  success: PullRequestLinkedThreadsResult,
  error: PullRequestRpcError,
});

const WsPullRequestsDetailRpc = Rpc.make(WS_METHODS.pullRequestsDetail, {
  payload: PullRequestRef,
  success: PullRequestDetail,
  error: PullRequestRpcError,
});

const WsPullRequestsPreviewRpc = Rpc.make(WS_METHODS.pullRequestsPreview, {
  payload: PullRequestRef,
  success: PullRequestPreview,
  error: PullRequestRpcError,
});

const WsPullRequestsChecksRpc = Rpc.make(WS_METHODS.pullRequestsChecks, {
  payload: PullRequestRef,
  success: Schema.NullOr(PullRequestChecks),
  error: PullRequestRpcError,
});

const WsPullRequestsActivityRpc = Rpc.make(WS_METHODS.pullRequestsActivity, {
  payload: PullRequestRef,
  success: PullRequestActivity,
  error: PullRequestRpcError,
});

const WsPullRequestsThreadCommentsRpc = Rpc.make(WS_METHODS.pullRequestsThreadComments, {
  payload: PullRequestThreadCommentsInput,
  success: PullRequestThreadCommentsResult,
  error: PullRequestRpcError,
});

const WsPullRequestsDiffFileContentsRpc = Rpc.make(WS_METHODS.pullRequestsDiffFileContents, {
  payload: PullRequestDiffFileContentsInput,
  success: PullRequestDiffFileContentsResult,
  error: PullRequestRpcError,
});

const WsPullRequestsFilesViewedRpc = Rpc.make(WS_METHODS.pullRequestsFilesViewed, {
  payload: PullRequestRef,
  success: PullRequestFilesViewedResult,
  error: PullRequestRpcError,
});

const WsPullRequestsChangeBreakdownRpc = Rpc.make(WS_METHODS.pullRequestsChangeBreakdown, {
  payload: PullRequestRef,
  success: PullRequestChangeBreakdown,
  error: PullRequestRpcError,
});

const WsPullRequestsSetFilesViewedRpc = Rpc.make(WS_METHODS.pullRequestsSetFilesViewed, {
  payload: PullRequestSetFilesViewedInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsRunActionRpc = Rpc.make(WS_METHODS.pullRequestsRunAction, {
  payload: PullRequestActionInput,
  // Undefined unless asked for with replyWithSummary, or when the host's reply lacked it.
  success: Schema.UndefinedOr(PullRequestSummary),
  error: PullRequestRpcError,
});

const WsPullRequestsUpdateRpc = Rpc.make(WS_METHODS.pullRequestsUpdate, {
  payload: PullRequestUpdateInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsCommentRpc = Rpc.make(WS_METHODS.pullRequestsComment, {
  payload: PullRequestCommentInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsUpdateCommentRpc = Rpc.make(WS_METHODS.pullRequestsUpdateComment, {
  payload: PullRequestCommentUpdateInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsSubmitReviewRpc = Rpc.make(WS_METHODS.pullRequestsSubmitReview, {
  payload: PullRequestSubmitReviewInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsReplyToThreadRpc = Rpc.make(WS_METHODS.pullRequestsReplyToThread, {
  payload: PullRequestThreadReplyInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsSetThreadResolutionRpc = Rpc.make(WS_METHODS.pullRequestsSetThreadResolution, {
  payload: PullRequestThreadResolutionInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsSetReactionRpc = Rpc.make(WS_METHODS.pullRequestsSetReaction, {
  payload: PullRequestReactionInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsInvalidateRpc = Rpc.make(WS_METHODS.pullRequestsInvalidate, {
  payload: PullRequestInvalidateInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsSubscribeRefreshesRpc = Rpc.make(WS_METHODS.pullRequestsSubscribeRefreshes, {
  payload: Schema.Struct({}),
  success: NonNegativeInt,
  error: EnvironmentAuthorizationError,
  stream: true,
});

// Fetch reviewer candidates only when the menu opens to avoid unused host requests.
const WsPullRequestsReviewerCandidatesRpc = Rpc.make(WS_METHODS.pullRequestsReviewerCandidates, {
  payload: PullRequestReviewerCandidatesInput,
  success: PullRequestReviewerCandidateList,
  error: PullRequestRpcError,
});

const WsPullRequestsRequestReviewersRpc = Rpc.make(WS_METHODS.pullRequestsRequestReviewers, {
  payload: PullRequestReviewerRequestInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsLabelCandidatesRpc = Rpc.make(WS_METHODS.pullRequestsLabelCandidates, {
  payload: PullRequestRef,
  success: PullRequestLabelCandidateList,
  error: PullRequestRpcError,
});

const WsPullRequestsSetLabelsRpc = Rpc.make(WS_METHODS.pullRequestsSetLabels, {
  payload: PullRequestLabelChangeInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: Schema.Union([ProjectSearchEntriesError, EnvironmentAuthorizationError]),
});

const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: Schema.Union([ProjectWriteFileError, EnvironmentAuthorizationError]),
});

const WsFilesystemGetMetadataRpc = Rpc.make(WS_METHODS.filesystemGetMetadata, {
  payload: FilesystemGetMetadataInput,
  success: FilesystemGetMetadataResult,
  error: EnvironmentAuthorizationError,
});

const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: Schema.Union([FilesystemBrowseError, EnvironmentAuthorizationError]),
});

const WsAssetsCreateUrlRpc = Rpc.make(WS_METHODS.assetsCreateUrl, {
  payload: AssetCreateUrlInput,
  success: AssetCreateUrlResult,
  error: Schema.Union([AssetAccessError, EnvironmentAuthorizationError]),
});

const WsSubscribeVcsBranchRpc = Rpc.make(WS_METHODS.subscribeVcsBranch, {
  payload: VcsStatusInput,
  success: VcsBranchStatus,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsVcsRefreshBranchRpc = Rpc.make(WS_METHODS.vcsRefreshBranch, {
  payload: VcsStatusInput,
  success: Schema.Void,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsSubscribeVcsStatusRpc = Rpc.make(WS_METHODS.subscribeVcsStatus, {
  payload: VcsStatusSubscriptionInput,
  success: VcsStatusStreamEvent,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsVcsPullRpc = Rpc.make(WS_METHODS.vcsPull, {
  payload: VcsPullInput,
  success: VcsPullResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsRefreshStatusRpc = Rpc.make(WS_METHODS.vcsRefreshStatus, {
  payload: Schema.Struct({
    ...VcsStatusInput.fields,
    localOnly: Schema.optional(Schema.Boolean),
  }),
  success: VcsStatusResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsVcsListRefsRpc = Rpc.make(WS_METHODS.vcsListRefs, {
  payload: VcsListRefsInput,
  success: VcsListRefsResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsCreateRefRpc = Rpc.make(WS_METHODS.vcsCreateRef, {
  payload: VcsCreateRefInput,
  success: VcsCreateRefResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsSwitchRefRpc = Rpc.make(WS_METHODS.vcsSwitchRef, {
  payload: VcsSwitchRefInput,
  success: VcsSwitchRefResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsInitRpc = Rpc.make(WS_METHODS.vcsInit, {
  payload: VcsInitInput,
  error: Schema.Union([VcsError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2DispatchCommandRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
  payload: OrchestrationV2RpcSchemas.dispatchCommand.input,
  success: OrchestrationV2RpcSchemas.dispatchCommand.output,
  error: Schema.Union([OrchestrationV2DispatchCommandError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetTurnDiffRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.getTurnDiff, {
  payload: OrchestrationV2RpcSchemas.getTurnDiff.input,
  success: OrchestrationV2RpcSchemas.getTurnDiff.output,
  error: Schema.Union([OrchestrationGetTurnDiffError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationV2RpcSchemas.getFullThreadDiff.input,
    success: OrchestrationV2RpcSchemas.getFullThreadDiff.output,
    error: Schema.Union([OrchestrationGetFullThreadDiffError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2SearchThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.searchThread, {
  payload: OrchestrationV2SearchThreadInput,
  success: OrchestrationV2SearchThreadResult,
  error: Schema.Union([OrchestrationV2SearchThreadError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2SearchThreadStreamRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.searchThreadStream,
  {
    payload: OrchestrationV2SearchThreadInput,
    success: OrchestrationV2SearchThreadResult,
    error: Schema.Union([OrchestrationV2SearchThreadError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

const WsOrchestrationV2SearchThreadsRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.searchThreads, {
  payload: OrchestrationV2SearchThreadsInput,
  success: OrchestrationV2SearchThreadsResult,
  error: Schema.Union([OrchestrationSearchThreadsError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetArchivedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot,
  {
    payload: OrchestrationV2RpcSchemas.getArchivedShellSnapshot.input,
    success: OrchestrationV2RpcSchemas.getArchivedShellSnapshot.output,
    error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetThreadFamilyRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.getThreadFamily, {
  payload: OrchestrationV2RpcSchemas.getThreadFamily.input,
  success: OrchestrationV2RpcSchemas.getThreadFamily.output,
  error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetThreadTitlesRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.getThreadTitles, {
  payload: OrchestrationV2RpcSchemas.getThreadTitles.input,
  success: OrchestrationV2RpcSchemas.getThreadTitles.output,
  error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetThreadLinkMetadataRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getThreadLinkMetadata,
  {
    payload: OrchestrationV2RpcSchemas.getThreadLinkMetadata.input,
    success: OrchestrationV2RpcSchemas.getThreadLinkMetadata.output,
    error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetWorktreeThreadIdsRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getWorktreeThreadIds,
  {
    payload: OrchestrationV2RpcSchemas.getWorktreeThreadIds.input,
    success: OrchestrationV2RpcSchemas.getWorktreeThreadIds.output,
    error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetOlderSettledThreadsRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getOlderSettledThreads,
  {
    payload: OrchestrationV2RpcSchemas.getOlderSettledThreads.input,
    success: OrchestrationV2RpcSchemas.getOlderSettledThreads.output,
    error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetThreadProjectionRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getThreadProjection,
  {
    payload: OrchestrationV2RpcSchemas.getThreadProjection.input,
    success: OrchestrationV2RpcSchemas.getThreadProjection.output,
    error: Schema.Union([OrchestrationV2GetThreadProjectionError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2StopWorkflowRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.stopWorkflow, {
  payload: OrchestrationV2RpcSchemas.stopWorkflow.input,
  success: OrchestrationV2RpcSchemas.stopWorkflow.output,
  error: Schema.Union([OrchestrationV2StopWorkflowError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2ForceStopThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.forceStopThread, {
  payload: OrchestrationV2RpcSchemas.forceStopThread.input,
  success: OrchestrationV2RpcSchemas.forceStopThread.output,
  error: Schema.Union([OrchestrationV2ForceStopThreadError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetWorkflowScriptRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getWorkflowScript,
  {
    payload: OrchestrationV2RpcSchemas.getWorkflowScript.input,
    success: OrchestrationV2RpcSchemas.getWorkflowScript.output,
    error: Schema.Union([OrchestrationGetWorkflowScriptError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetNativeChildWorkRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getNativeChildWork,
  {
    payload: OrchestrationV2RpcSchemas.getNativeChildWork.input,
    success: OrchestrationV2RpcSchemas.getNativeChildWork.output,
    error: Schema.Union([OrchestrationV2GetNativeChildWorkError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetTurnItemRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.getTurnItem, {
  payload: OrchestrationV2RpcSchemas.getTurnItem.input,
  success: OrchestrationV2RpcSchemas.getTurnItem.output,
  error: Schema.Union([OrchestrationV2GetThreadProjectionError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2LaunchThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.launchThread, {
  payload: OrchestrationV2RpcSchemas.launchThread.input,
  success: OrchestrationV2RpcSchemas.launchThread.output,
  error: Schema.Union([OrchestrationV2ThreadLaunchError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2SubscribeShellRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.subscribeShell, {
  payload: OrchestrationV2RpcSchemas.subscribeShell.input,
  success: OrchestrationV2RpcSchemas.subscribeShell.output,
  error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsOrchestrationV2SubscribeThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.subscribeThread, {
  payload: OrchestrationV2RpcSchemas.subscribeThread.input,
  success: OrchestrationV2RpcSchemas.subscribeThread.output,
  error: Schema.Union([OrchestrationV2GetThreadProjectionError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsOrchestrationV2SubscribeCommandOutputRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput,
  {
    payload: OrchestrationV2RpcSchemas.subscribeCommandOutput.input,
    success: OrchestrationV2RpcSchemas.subscribeCommandOutput.output,
    error: Schema.Union([OrchestrationV2CommandOutputError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

const WsOrchestrationV2SubscribePromptSuggestionRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.subscribePromptSuggestion,
  {
    payload: OrchestrationV2RpcSchemas.subscribePromptSuggestion.input,
    success: OrchestrationV2RpcSchemas.subscribePromptSuggestion.output,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);

export class RpcScopeAuthorization extends RpcMiddleware.Service<RpcScopeAuthorization>()(
  "t3/contracts/RpcScopeAuthorization",
  { error: EnvironmentAuthorizationError },
) {}

export const WsRpcGroup = RpcGroup.make(
  WsServerGetUsageSummaryRpc,
  WsServerRefreshUsageRatesRpc,
  WsPullRequestsListRpc,
  WsPullRequestsListStatsRpc,
  WsPullRequestsFilterOptionsRpc,
  WsPullRequestsSummaryRpc,
  WsPullRequestsStackRpc,
  WsPullRequestsLinkedThreadsRpc,
  WsPullRequestsDetailRpc,
  WsPullRequestsPreviewRpc,
  WsPullRequestsChecksRpc,
  WsPullRequestsActivityRpc,
  WsPullRequestsThreadCommentsRpc,
  WsPullRequestsDiffFileContentsRpc,
  WsPullRequestsFilesViewedRpc,
  WsPullRequestsChangeBreakdownRpc,
  WsPullRequestsSetFilesViewedRpc,
  WsPullRequestsRunActionRpc,
  WsPullRequestsUpdateRpc,
  WsPullRequestsCommentRpc,
  WsPullRequestsUpdateCommentRpc,
  WsPullRequestsSubmitReviewRpc,
  WsPullRequestsReplyToThreadRpc,
  WsPullRequestsSetThreadResolutionRpc,
  WsPullRequestsSetReactionRpc,
  WsPullRequestsInvalidateRpc,
  WsPullRequestsSubscribeRefreshesRpc,
  WsPullRequestsReviewerCandidatesRpc,
  WsPullRequestsRequestReviewersRpc,
  WsPullRequestsLabelCandidatesRpc,
  WsPullRequestsSetLabelsRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsFilesystemBrowseRpc,
  WsFilesystemGetMetadataRpc,
  WsAssetsCreateUrlRpc,
  WsSubscribeVcsStatusRpc,
  WsSubscribeVcsBranchRpc,
  WsVcsRefreshBranchRpc,
  WsVcsPullRpc,
  WsVcsRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsVcsListRefsRpc,
  WsVcsCreateRefRpc,
  WsVcsSwitchRefRpc,
  WsVcsInitRpc,
  WsOrchestrationV2DispatchCommandRpc,
  WsOrchestrationV2GetWorkflowScriptRpc,
  WsOrchestrationV2GetNativeChildWorkRpc,
  WsOrchestrationV2StopWorkflowRpc,
  WsOrchestrationV2ForceStopThreadRpc,
  WsOrchestrationV2GetTurnItemRpc,
  WsOrchestrationV2GetTurnDiffRpc,
  WsOrchestrationV2GetFullThreadDiffRpc,
  WsOrchestrationV2SearchThreadsRpc,
  WsOrchestrationV2SearchThreadRpc,
  WsOrchestrationV2SearchThreadStreamRpc,
  WsOrchestrationV2GetArchivedShellSnapshotRpc,
  WsOrchestrationV2GetThreadFamilyRpc,
  WsOrchestrationV2GetThreadTitlesRpc,
  WsOrchestrationV2GetThreadLinkMetadataRpc,
  WsOrchestrationV2GetWorktreeThreadIdsRpc,
  WsOrchestrationV2GetOlderSettledThreadsRpc,
  WsOrchestrationV2GetThreadProjectionRpc,
  WsOrchestrationV2LaunchThreadRpc,
  WsOrchestrationV2SubscribeShellRpc,
  WsOrchestrationV2SubscribeThreadRpc,
  WsOrchestrationV2SubscribeCommandOutputRpc,
  WsOrchestrationV2SubscribePromptSuggestionRpc,
).middleware(RpcScopeAuthorization);
