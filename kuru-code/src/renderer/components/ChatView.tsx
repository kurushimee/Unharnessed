import { ChildThreadApprovals } from "./chat/ChildThreadApprovals";
import { workspaceAreaProps } from "../lib/workspaceFocus";
import { sourceControlClients } from "~/rt/sourceControlClients";
import { resolveNewThreadModelSelection } from "~/shared/usageLimits";
import { queuedRunEditBlockedReason } from "~/rt/queuedRunEdit";
import { ScrollToEndButton, WorkspaceFileDropOverlay } from "./chat/TimelineOverlays";
import { usePasteToFocusComposer } from "./chat/usePasteToFocusComposer";
import { announcedRun, isDetailBehindShell } from "./chat/threadActivityAnnouncement";
import {
  deriveAvailableRevertTurnCounts,
  deriveThreadPendingBackgroundTasks,
  presentThreadShellFromProjection,
} from "./ChatView.logic";
import { usePullRequestDraftThread } from "./chat/usePullRequestDraftThread";
import { useComposerSelection } from "./chat/useComposerSelection";
import { useAttachmentPreviewHandoff } from "./chat/useAttachmentPreviewHandoff";
import {
  applyOptimisticUserMessagesAction,
  createOptimisticBlobPreviews,
  emptyOptimisticUserMessages,
  reconcileOptimisticUserMessages,
} from "./chat/optimisticUserMessages";
import { useTimelineRewind } from "./chat/useTimelineRewind";
import { useThreadLifecycle } from "./chat/useThreadLifecycle";
import { useComposerSend } from "./chat/useComposerSend";
import { useComposerResume } from "./chat/useComposerResume";
import { ThreadFind, ThreadFindCanvas } from "./chat/ThreadFindProvider";
import { closeThreadFind, openThreadFind, useThreadFindOpen } from "./chat/threadFindStore";
import { THREAD_FIND_BAR_RESERVED_HEIGHT } from "./chat/ThreadFindBar";
import { resolveDraftHeroState } from "./ChatView.logic";
import { useQueuedRunEdit } from "./chat/useQueuedRunEdit";
import { recallCheckoutIsRepo, rememberCheckoutIsRepo } from "./ChatView.logic";
import { useStableCallback } from "../hooks/useStableCallback";
import { usePendingThreadRequests } from "./chat/usePendingThreadRequests";
import { visibleThreadPullRequests } from "~/shared/threadPullRequests";
import { DEFAULT_RUNTIME_MODE, type UsageLimitSourceSnapshots } from "~/contracts";
import { requestWorkspaceContentFocus, requestWorkspaceFocus } from "~/lib/workspaceFocus";
import { freshSessionBannerItem } from "./chat/ComposerFreshSession";
import { armFreshSession, disarmFreshSession, useFreshSessionArmed } from "./chat/freshSessionArms";
import { useUsageLimitsPanel } from "./chat/useUsageLimitsPanel";
import { useChatShortcuts } from "./chat/useChatShortcuts";
import { ChatBannerLane } from "./chat/ChatBannerLane";
import * as Schema from "effect/Schema";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  type AssistantCitation,
  type ChatFileAttachment,
  isProviderNativeSubagentThread,
  type EnvironmentId,
  type MessageId,
  ProviderInstanceId,
  type ServerProvider,
  type ScopedThreadRef,
  type ThreadId,
  resolveIdleCompaction,
} from "~/contracts";
import {
  deriveProviderSubagentStatus,
  deriveProviderExtensionStatuses,
  deriveReportedModelSelection,
  deriveResumableRunId,
  formatModelSelectionEffort,
  deriveRunlessWorkStartedAt,
  deriveThreadActivityRun,
  deriveLatestThreadRun,
  deriveThreadStructureRuntime,
} from "~/rt/state/threadExecution";
import { resolveWorkflowOpening, workflowOpeningParentThreadId } from "~/rt/state/subagentRuntime";
import { getUserQueuedThreadRuns, threadSupportsProviderHandoff } from "~/rt/state/threadWorkflows";
import { resolvePendingHandoff } from "~/rt/handoff";
import { HandoffRow } from "./chat/V2LifecycleRow";
import {
  deriveWorkspaceMutationId,
  isCompleteTurnItemRow,
  shouldShowLoadEarlierControl,
  type CodexFeedbackSubmission,
} from "~/rt/state/threads";
import { parseScopedThreadKey, scopedThreadKey, scopeProjectRef, scopeThreadRef } from "~/rt/environment/index";
import { formatModelSlugName, resolveSelectableModel } from "~/shared/model";
import { resolveProjectSettings } from "~/shared/projectSettings";
import { resolveThreadReferenceCopyTarget } from "~/rt/threadReference";
import { useAtomValue } from "@effect/atom-react";
import { type SetStateAction, use, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BackgroundThreadContext } from "./chat/backgroundThread";
import { WorkspaceMutationIdContext } from "./chat/ChatMarkdownMedia";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { assistantCitationFromLocation } from "../lib/assistantCitationNavigation";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { useStore } from "zustand";
import { shallow } from "zustand/vanilla/shallow";
import { useShallow } from "zustand/react/shallow";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "~/rt/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { isElectron } from "../env";
import { useActiveThreadRef } from "../hooks/useActiveThreadRef";
import { composerRequiresModifier } from "../composer-logic";
import {
  derivePhase,
  deriveActiveWorkStartedAt,
  deriveCanInterruptRunningThread,
  findRevertCheckpoint,
  isLatestRunSettled,
} from "../session-logic";
import { type LegendListRef } from "@legendapp/list/react";
import { useWorkspaceMutationRefresh } from "../hooks/useWorkspaceMutationRefresh";
import { type ChatMessage } from "../types";
import { buildThreadRouteParams } from "../threadRoutes";
import { useTheme } from "../hooks/useTheme";
import { copyThreadReference } from "../lib/copyThreadReference";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { FileMetadataThreadProvider } from "../hooks/FileMetadataThreadProvider";
import { PopoverCreateHandle } from "./ui/popover";
import { selectThreadPanelOpen, useThreadPanelStore } from "../threadPanelStore";
import { createChatCanvasStore, resolveChatCanvasModel } from "./chat/canvasStore";

import { LinkPullRequestDialogHost } from "./pullRequest/LinkPullRequestDialog";
import { BranchToolbar, type BranchToolbarHandle } from "./BranchToolbar";
import { makeWorkspaceFileDropHandlers } from "./chat/workspaceFileDrop";
import { isEditableFocused } from "../lib/editableFocus";
import { shortcutLabelForCommand } from "../keybindings";
import { cn } from "~/lib/utils";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { toastManager } from "./ui/toast";
import {
  NO_PROVIDER_MODEL_SELECTION,
  providerInstanceEntriesFor,
  resolveProjectDefaultProviderModelSelection,
  shouldShowInstanceBadge,
} from "../providerInstances";
import { useClientSettingsHydrated, useEnvironmentSettings } from "../hooks/useSettings";
import { useNowMinute } from "../hooks/useNowMinute";
import { usePanelAnimationSettings } from "../panelAnimations";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { deriveLogicalProjectKeyFromSettings, selectProjectGroupingSettings } from "~/rt/state/projectGrouping";
import { isSameSidebarThreadRef, useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import {
  composerDraftHasUserContent,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  useComposerDraftStore,
  DraftId,
} from "../composerDraftStore";
import { collectInlineContextIds } from "../lib/composerContextReferences";
import { useEnvironmentQueryRefresh } from "../state/query";
import { useEnvironmentScope } from "~/state/session";
import { primaryServerKeybindingsAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { resolveProviderSkillsForCwd } from "~/rt/providerSkills";
import { chatGitStatusAtom, NO_CHAT_GIT_STATUS_ATOM, vcsEnvironment } from "../state/vcs";
import {
  type EnvironmentPresentation,
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironment,
} from "../state/environments";
import {
  resolveThreadDetailRef,
  useProject,
  useQuietThreadProjection,
  useThreadUpdatedAt,
  useThreadLastVisitedAt,
  useQuietThreadVisibleTurnItems,
  useThreadStatus,
  useThreadHistory,
  useQuietThreadShell,
  useThreadCheckpointSummaries,
} from "../state/entities";
import { ChatComposer, type ChatComposerHandle } from "./chat/ChatComposer";
import { DraftHeroHeadline } from "./chat/DraftHeroHeadline";
import { ExpandedImageDialogHost, openExpandedImagePreview } from "./chat/ExpandedImageDialog";
import {
  BranchRestoreConfirmHost,
  openBranchRestoreConfirm,
  PullRequestThreadDialogHost,
  RevertConfirmHost,
} from "./chat/ChatOverlayHosts";
import type { AssistantCitationRequest } from "./chat/AssistantCitationSource";
import { useCitedHistory } from "./chat/citationProcedure";
import type { MessagesTimelineHistoryControls } from "./chat/MessagesTimeline";
import { ThreadTimeline } from "./chat/ThreadTimeline";
import { ProviderSubagentBar } from "./chat/ProviderSubagentBar";
import { getTriggerDisplayModelName } from "./chat/providerIconUtils";
import { resolveScrollToEndClearance } from "./composerFooterLayout";
import { ChatHeader } from "./chat/ChatHeader";
import { PanelLayoutControls, WorkspaceTitlebarControls } from "./chat/PanelLayoutControls";
import type { ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { ThreadDetailsPanel } from "./chat/ThreadDetailsPanel";
import { NoActiveThreadState } from "./NoActiveThreadState";
import { resolveLocalCheckoutBranchMismatch, shouldShowComposerContextStrip } from "./BranchToolbar.logic";
import { getProviderStatusBannerKey, shouldShowProviderStatusBanner } from "./chat/ProviderStatusBanner";
import {
  getThreadErrorBannerKey,
  isThreadErrorBannerDismissedForSession,
  shouldShowThreadErrorBanner,
} from "./chat/ThreadErrorBanner";
import { QueuedRunsControl, type QueuedRunsControlHandle } from "./chat/QueuedRunsControl";
import { useThreadLinkedPullRequest } from "./pullRequest/useThreadLinkedPullRequest";
import { useIncrementalTimelineEntries } from "../hooks/useIncrementalTimelineEntries";
import { ComposerBannerStack, type ComposerBannerStackItem } from "./chat/ComposerBannerStack";
import { modelFallbackBannerItem } from "./chat/ComposerUsageLimits";
import { ComposerSurface } from "./chat/ComposerSurface";
import { resolveThreadSyncPhase } from "../threadSync";
import { hasAvailableCompactionProvider } from "./chat/compaction.logic";
import {
  deriveLatestContextWindowSnapshot,
  hasDismissedResumeCompaction,
  latestProviderTurnTokenUsage,
  shouldOfferResumeCompaction,
} from "~/rt/state/contextWindow";
import {
  MOBILE_COMPOSER_VIEW_TRANSITION_NAME,
  MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME,
} from "./chat/draftHeroTransition";
import {
  buildLocalDraftThread,
  deriveCommittedServerUserMessageIds,
  dismissBranchMismatchForSession,
  deriveLockedProvider,
  resolveFileAttachmentUrl,
  resolveComposerProviderSelection,
  resolveThreadMetadataUpdateForNextTurn,
  startNewThreadForProject,
  shouldRefocusComposerOnWindowFocus,
} from "./ChatView.logic";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useComposerHandleContext } from "../composerHandleContext";
import { assetEnvironment } from "../state/assets";
import { readEnvironmentScope, readPreparedConnection } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { observeResize } from "~/lib/observeResize";
import { ThreadVisitWatermark } from "./chat/ThreadVisitWatermark";
import { branchMismatchBannerItem, extensionStatusBannerItem } from "./chat/ThreadActivityBanners";
import { ThreadNow } from "./chat/ThreadNow";
import type { ThreadStructure } from "~/rt/state/models";
import { useDelayedStatus } from "../hooks/useDelayedStatus";
import { useTimelineFollow } from "./chat/useTimelineFollow";
import { useDraftHeroLayoutTransition } from "./chat/useDraftHeroLayoutTransition";
import { useLocalDispatchState } from "./chat/useLocalDispatchState";
import { draftSendState } from "./chat/chatViewSend";
import {
  isCompactCommandMessage,
  type LocalThreadErrorEntry,
  makeThreadErrorSetter,
} from "./ChatView.logic";

const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_PROVIDER_MODELS: ServerProvider["models"] = [];
const EMPTY_USAGE_LIMIT_SOURCES: UsageLimitSourceSnapshots = [];

const EMPTY_FEEDBACK_SUBMISSIONS: ReadonlyArray<CodexFeedbackSubmission> = [];
const EMPTY_PROVIDER_SKILLS: ServerProvider["skills"] = [];
const EMPTY_TURN_ITEMS: ThreadStructure["turnItems"] = [];
const EMPTY_RUNS: ThreadStructure["runs"] = [];
const EMPTY_AUTO_UPDATE_ENVIRONMENTS: ReadonlyArray<EnvironmentPresentation> = [];
const EMPTY_COMPOSER_BANNER_ITEMS: ReadonlyArray<ComposerBannerStackItem> = [];

const EMPTY_PENDING_FILE_SURFACE_IDS: ReadonlySet<string> = new Set();

type ChatViewProps =
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      forceExpandedMobileComposer?: boolean;
      routeKind: "server";
      draftId?: never;
    }
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      forceExpandedMobileComposer?: boolean;
      routeKind: "draft";
      draftId: DraftId;
    };

const DismissedFallbackWindowSchema = Schema.NullOr(Schema.String);

export default function ChatView(props: ChatViewProps) {
  const {
    environmentId,
    threadId,
    routeKind,
    onDiffPanelOpen,
    reserveTitleBarControlInset = true,
    forceExpandedMobileComposer = false,
  } = props;
  const canOperateThread = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const draftId = routeKind === "draft" ? props.draftId : null;
  const handleNewThread = useNewThreadHandler();
  const routeThreadRef = scopeThreadRef(environmentId, threadId);
  const routeThreadKey = scopedThreadKey(routeThreadRef);
  const currentRouteThreadKeyRef = useRef<string | null>(routeThreadKey);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the committed route thread key to a ref that async handlers check before applying results
  useLayoutEffect(() => {
    currentRouteThreadKeyRef.current = routeThreadKey;
    return () => {
      currentRouteThreadKeyRef.current = null;
    };
  }, [routeThreadKey]);
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const canWriteSourceControl = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const createAttachmentAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const interruptThreadTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const loadEarlierThreadHistory = useAtomCommand(threadEnvironment.loadEarlierHistory, {
    label: "load earlier thread history",
    reportFailure: false,
  });
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentById = new Map(
    environments.map((environment) => [environment.environmentId, environment]),
  );
  const baseComposerDraftTarget: ScopedThreadRef | DraftId =
    routeKind === "server" ? routeThreadRef : props.draftId;
  const draftThread = useComposerDraftStore((store) =>
    routeKind === "server"
      ? store.getDraftSessionByRef(routeThreadRef)
      : draftId
        ? store.getDraftSession(draftId)
        : null,
  );
  const serverThreadShell = useQuietThreadShell(routeThreadRef);
  const routeThreadDetailRef = resolveThreadDetailRef(routeThreadRef, {
    shellExists: serverThreadShell !== null,
    waitForShell: draftThread !== null,
  });
  const serverThreadProjection = useQuietThreadProjection(routeThreadDetailRef);
  const serverProjection = serverThreadProjection?.projection ?? null;
  // Only the shell-less fallback needs these; with a shell, the shell carries them.
  const fallbackDetailRef = serverThreadShell === null ? routeThreadDetailRef : null;
  const fallbackUpdatedAt = useThreadUpdatedAt(fallbackDetailRef);
  const fallbackLastVisitedAt = useThreadLastVisitedAt(fallbackDetailRef);
  const serverThread =
    serverThreadShell !== null || serverProjection === null || fallbackUpdatedAt === null
      ? serverThreadShell
      : presentThreadShellFromProjection(environmentId, threadId, serverProjection, {
          updatedAt: fallbackUpdatedAt,
          lastVisitedAt: fallbackLastVisitedAt,
        });
  const promptRef = useRef("");
  const localComposerRef = useRef<ChatComposerHandle | null>(null);
  const composerRef = useComposerHandleContext() ?? localComposerRef;
  const queuedRunEdit = useQueuedRunEdit({
    environmentId,
    routeThreadRef,
    threadDraftTarget: baseComposerDraftTarget,
    activeThreadId: serverThread !== null || draftThread !== null ? threadId : null,
    serverProjection,
    promptRef,
    composerRef,
  });
  const composerDraftTarget = queuedRunEdit.draftTarget;
  const reportedModelSelection = serverProjection
    ? deriveReportedModelSelection(serverProjection)
    : null;
  const threadStatus = useThreadStatus(routeThreadDetailRef);
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverProjection !== null,
    shellExists: serverThread !== null,
    status: threadStatus,
  });
  const threadDetailLoading = threadSyncPhase === "loading";
  // Held back briefly, so a quick sync does not flash a status line at the end of the timeline.
  const delayedThreadSyncPhase = useDelayedStatus(routeThreadKey, threadSyncPhase);
  const activeProviderThread = serverProjection?.providerThreads.find(
    (thread) => thread.id === serverProjection.thread.activeProviderThreadId,
  );
  const activeThreadLiveTokenUsage = latestProviderTurnTokenUsage(
    serverProjection?.providerTurns ?? [],
    serverProjection,
    activeProviderThread,
  );
  const serverVisibleTurnItems = useQuietThreadVisibleTurnItems(routeThreadDetailRef);
  const serverThreadHistory = useThreadHistory(routeThreadDetailRef);
  const threadHistoryControls = (() => {
    if (routeThreadDetailRef === null || !shouldShowLoadEarlierControl(serverThreadHistory)) {
      return undefined;
    }
    return {
      hasMoreHistory: serverThreadHistory.hasMoreHistory,
      loading: serverThreadHistory.loading,
      error: serverThreadHistory.error,
      onLoadEarlier: (throughEntryId) => {
        void loadEarlierThreadHistory({
          environmentId: routeThreadDetailRef.environmentId,
          input: {
            threadId: routeThreadDetailRef.threadId,
            ...(throughEntryId === undefined ? {} : { throughEntryId }),
          },
        });
      },
    };
  })() as MessagesTimelineHistoryControls | undefined;
  const committedServerMessageIds = deriveCommittedServerUserMessageIds(serverVisibleTurnItems);
  // Queued messages have no turn item until starting, so cancellation must retire their optimistic rows
  // separately.
  const serverAcknowledgedUserMessageIds = (() => {
    const ids = new Set(committedServerMessageIds);
    for (const message of serverProjection?.messages ?? []) {
      if (message.role === "user") ids.add(message.id);
    }
    return ids;
  })();
  const settings = useEnvironmentSettings(environmentId);
  const clientSettingsHydrated = useClientSettingsHydrated();
  const timestampFormat = settings.timestampFormat;
  const navigate = useNavigate();
  // Selects primitives: an object here is new on every router store update, which
  // re-renders ChatView on unrelated navigation state changes.
  const citationHref = useLocation({ select: (location) => location.href });
  const citationKey = useLocation({
    select: (location) => location.state.assistantCitationActivation ?? location.state.__TSR_key,
  });
  const citationLocation = { href: citationHref, key: citationKey };
  const locationCitation = assistantCitationFromLocation(citationLocation.href);
  const citationActivation = citationLocation.key ?? citationLocation.href;
  const citationRequest = (
    locationCitation &&
    locationCitation.environmentId === environmentId &&
    locationCitation.threadId === threadId
      ? { citation: locationCitation, key: citationActivation }
      : null
  ) as AssistantCitationRequest | null;
  const citationHistory = useCitedHistory(citationRequest);
  const { resolvedTheme } = useTheme();
  const composerActiveProvider = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.activeProvider ?? null,
  );
  const composerSelectedModelSelection = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return draft?.activeProvider
      ? (draft.modelSelectionByProvider[draft.activeProvider] ?? null)
      : null;
  });
  const composerModelSelectionExplicit = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.modelSelectionExplicit === true,
  );
  const composerHasAttachments = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return (draft?.images.length ?? 0) > 0 || (draft?.files.length ?? 0) > 0;
  });
  const referencedThreadContexts = useComposerDraftStore(
    useShallow((store) => {
      const draft = store.getComposerDraft(composerDraftTarget);
      if (!draft?.threadContexts.length) return [];
      // Linked prompts can replace text without pruning stored context records.
      const referenced = new Set(collectInlineContextIds(draft.prompt));
      return draft.threadContexts.filter((record) => referenced.has(record.contextId));
    }),
  );
  const composerHasNonPromptContent = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return draft ? composerDraftHasUserContent({ ...draft, prompt: "" }) : false;
  });
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerFilesRef = useRef<ComposerFileAttachment[]>([]);
  const branchToolbarRef = useRef<BranchToolbarHandle>(null);
  const citeAssistantText = (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor,
  ) => {
    const inserted = composerRef.current?.citeAssistantText(citation, sourceAnchor) ?? false;
    if (!inserted) {
      toastManager.add({
        type: "warning",
        title: "The composer is not ready",
        description: "Try citing the selection after the connection or pending input is resolved.",
      });
    }
    return inserted;
  };
  const citeAssistantTextStable = useStableCallback(citeAssistantText);
  const [isWorkspaceFileDragActive, setIsWorkspaceFileDragActive] = useState(false);
  const [optimisticBlobPreviews] = useState(createOptimisticBlobPreviews);
  const [heldOptimisticUserMessages, setHeldOptimisticUserMessages] = useState(() =>
    emptyOptimisticUserMessages(threadId),
  );
  // Acknowledged messages leave the timeline in the same render the server's copy enters it.
  const optimisticState = reconcileOptimisticUserMessages(
    heldOptimisticUserMessages,
    threadId,
    serverAcknowledgedUserMessageIds,
  );
  if (optimisticState !== heldOptimisticUserMessages) {
    // Idempotent, and a discarded render only delays revocation to the thread's end.
    optimisticBlobPreviews.handOff(optimisticState);
    setHeldOptimisticUserMessages(optimisticState);
  }
  const optimisticUserMessages = optimisticState.messages;
  const setOptimisticUserMessages = (action: SetStateAction<ChatMessage[]>) =>
    setHeldOptimisticUserMessages((state) =>
      applyOptimisticUserMessagesAction(state, threadId, action),
    );
  const [localDraftErrorsByDraftId, setLocalDraftErrorsByDraftId] = useState<
    Record<string, LocalThreadErrorEntry>
  >({});
  const [localServerErrorsByThreadKey, setLocalServerErrorsByThreadKey] = useState<
    Record<string, LocalThreadErrorEntry>
  >({});
  const isRevertingCheckpoint = useComposerDraftStore((store) =>
    store.rewindingThreadKeys.has(routeThreadKey),
  );

  const workspaceFileDragRouteKey = `${routeThreadKey}:${draftId ?? ""}`;
  const [workspaceFileDragRoute, setWorkspaceFileDragRoute] = useState(workspaceFileDragRouteKey);
  if (workspaceFileDragRoute !== workspaceFileDragRouteKey) {
    setWorkspaceFileDragRoute(workspaceFileDragRouteKey);
    setIsWorkspaceFileDragActive(false);
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window dragend listener that clears the workspace file drag state
  useEffect(() => {
    if (!isWorkspaceFileDragActive) return;
    const clearWorkspaceFileDrag = () => setIsWorkspaceFileDragActive(false);
    window.addEventListener("dragend", clearWorkspaceFileDrag);
    return () => window.removeEventListener("dragend", clearWorkspaceFileDrag);
  }, [isWorkspaceFileDragActive]);
  const isMobileViewport = useMediaQuery("max-sm");
  const threadPanelPopoverAnchorRef = useRef<HTMLElement | null>(null);
  // A branch chosen before a server thread's first turn; it belongs to that thread only.
  const [pendingServerThreadBranchEntry, setPendingServerThreadBranchEntry] = useState<{
    readonly threadId: ThreadId;
    readonly branch: string | null;
  } | null>(null);
  const legendListRef = useRef<LegendListRef | null>(null);
  const conversationArea = workspaceAreaProps("conversation", 1, "Conversation");
  const composerArea = workspaceAreaProps("composer", 2, "Message input");
  const [composerOverlayElement, setComposerOverlayElement] = useState<HTMLDivElement | null>(null);
  const [composerTimelineInset, setComposerTimelineInset] = useState(0);
  const composerTimelineInsetRef = useRef(0);
  const [composerReservedHeight, setComposerReservedHeight] = useState(0);
  const composerReservedHeightRef = useRef(0);
  const composerExpandedHeightRef = useRef(0);
  const [scrollToEndClearance, setScrollToEndClearance] = useState(0);
  const { sendInFlight: sendInFlightRef } = draftSendState(routeThreadKey);

  const fallbackDraftProjectRef = draftThread
    ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
    : null;
  const fallbackDraftProject = useProject(fallbackDraftProjectRef);
  const localDraftError = serverThread
    ? null
    : ((draftId ? localDraftErrorsByDraftId[draftId]?.message : null) ?? null);
  const localServerError = localServerErrorsByThreadKey[routeThreadKey]?.message ?? null;
  const promotedDraftError =
    serverThread && draftId ? localDraftErrorsByDraftId[draftId] : undefined;
  if (promotedDraftError !== undefined && draftId) {
    const remainingDraftErrors = { ...localDraftErrorsByDraftId };
    delete remainingDraftErrors[draftId];
    setLocalDraftErrorsByDraftId(remainingDraftErrors);
    const currentEntry = localServerErrorsByThreadKey[routeThreadKey];
    if (
      currentEntry === undefined ||
      (currentEntry.at <= promotedDraftError.at &&
        currentEntry.message !== promotedDraftError.message)
    ) {
      setLocalServerErrorsByThreadKey({
        ...localServerErrorsByThreadKey,
        [routeThreadKey]: promotedDraftError,
      });
    }
  }
  const nowMinute = useNowMinute();
  const draftDefaultModelSelection = draftThread
    ? resolveProjectSettings(
        settings,
        fallbackDraftProject?.id ?? null,
        fallbackDraftProject ?? undefined,
      ).settings.defaultModelSelection
    : null;
  const draftModelResolution = draftThread
    ? resolveNewThreadModelSelection({
        defaultSelection:
          draftDefaultModelSelection ??
          resolveProjectDefaultProviderModelSelection(
            providersByEnvironment.get(draftThread.environmentId) ?? [],
            settings,
            draftThread.projectId,
          ),
        fallbackSelection: settings.fallbackModelSelection,
        providers: providersByEnvironment.get(draftThread.environmentId) ?? [],
        settings,
        projectId: draftThread.projectId,
        now: Date.parse(`${nowMinute}:00Z`),
      })
    : null;
  const draftFallback = draftModelResolution?.fallback ? draftModelResolution : null;
  const localDraftThread = draftThread
    ? buildLocalDraftThread(
        threadId,
        draftThread,
        (draftFallback ? draftFallback.selection : draftDefaultModelSelection) ??
          NO_PROVIDER_MODEL_SELECTION,
      )
    : undefined;
  const isServerThread = serverThread !== null;
  const activeThread = isServerThread ? serverThread : localDraftThread;
  const serverLatestRun =
    serverProjection === null ? null : deriveLatestThreadRun(serverProjection);
  const serverActivityRun =
    serverProjection === null ? null : deriveThreadActivityRun(serverProjection);
  const serverRuntime =
    serverProjection === null ? null : deriveThreadStructureRuntime(serverProjection);
  const runlessWorkStartedAt =
    serverProjection === null ? null : deriveRunlessWorkStartedAt(serverProjection);
  const providerSubagentStatus =
    serverProjection === null ? null : deriveProviderSubagentStatus(serverProjection);
  const isProviderSubagent =
    serverThread !== null && isProviderNativeSubagentThread(serverThread.source);
  const supportsProviderSwitchingViaHandoff = threadSupportsProviderHandoff(serverProjection);
  const activeLatestRun = isServerThread ? serverLatestRun : (activeThread?.latestRun ?? null);
  const activeActivityRun = isServerThread ? serverActivityRun : (activeThread?.latestRun ?? null);
  const activeRuntime = isServerThread ? serverRuntime : (activeThread?.runtime ?? null);
  const hasHeldQueuedRuns =
    isServerThread &&
    serverProjection?.runs.some((run) => run.status === "queued" && run.queueHeld === true) ===
      true;
  const resumableRunId =
    !isServerThread || serverProjection === null
      ? null
      : deriveResumableRunId(serverProjection, serverRuntime);
  const parentSubagentThreadId =
    activeThread?.lineage.relationshipToParent === "subagent"
      ? activeThread.lineage.parentThreadId
      : null;
  const parentSubagentEnvironmentId = activeThread?.environmentId ?? null;
  const parentSubagentThreadRef = (() => {
    if (parentSubagentEnvironmentId === null || parentSubagentThreadId === null) {
      return null;
    }
    return scopeThreadRef(parentSubagentEnvironmentId, parentSubagentThreadId);
  })();
  const parentSubagentThread = useQuietThreadShell(parentSubagentThreadRef);
  // Workflow threads open with a script; their replacement plan lives on the parent's coordinator row.
  const workflowOpeningParentId =
    serverProjection === null
      ? null
      : workflowOpeningParentThreadId({
          thread: serverProjection.thread,
          messages: serverProjection.messages,
        });
  const workflowOpeningParentProjection = useQuietThreadProjection(
    workflowOpeningParentId === null || parentSubagentEnvironmentId === null
      ? null
      : scopeThreadRef(parentSubagentEnvironmentId, workflowOpeningParentId),
  );
  const workflowOpening =
    serverProjection === null || workflowOpeningParentId === null
      ? null
      : resolveWorkflowOpening({
          thread: serverProjection.thread,
          messages: serverProjection.messages,
          parentSubagents: workflowOpeningParentProjection?.projection.subagents ?? null,
        });
  const parentThreadLink =
    parentSubagentThreadRef === null
      ? null
      : {
          title: parentSubagentThread?.title ?? "Parent thread",
          open: (): void => {
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(parentSubagentThreadRef),
            });
          },
        };
  // The header's breadcrumb opens a parent in this environment only.
  const headerParentThreadLink =
    parentSubagentThreadRef === null
      ? null
      : {
          threadId: parentSubagentThreadRef.threadId,
          title: parentSubagentThread?.title ?? "Parent thread",
        };
  const threadError = isServerThread
    ? (localServerError ?? serverRuntime?.lastError ?? null)
    : localDraftError;
  const threadErrorBannerKey = getThreadErrorBannerKey(routeThreadKey, threadError);
  const visibleThreadError = shouldShowThreadErrorBanner(
    routeThreadKey,
    threadError,
    isThreadErrorBannerDismissedForSession(threadErrorBannerKey),
  )
    ? threadError
    : null;
  const [, setThreadErrorBannerDismissTick] = useState(0);
  const threadErrorIsServerRuntimeError =
    localServerError === null && visibleThreadError === serverRuntime?.lastError;
  // Unharnessed runs every turn with its own approval rules, so the mode is never changed here.
  const runtimeMode =
    (isServerThread ? activeThread?.runtimeMode : undefined) ?? DEFAULT_RUNTIME_MODE;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const canCheckoutPullRequestIntoThread = canWriteSourceControl && isLocalDraftThread;
  const activeThreadId = activeThread?.id ?? null;
  // Turn items can lag projection hydration; keep the environment locked through that gap.
  const activeMessageCount = isServerThread
    ? Math.max(committedServerMessageIds.size, serverProjection?.messages.length ?? 0)
    : 0;
  const activeThreadRef = useActiveThreadRef(activeThread);
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const activeThreadShell = serverThread;
  const timelineThreadError = visibleThreadError;

  const [timelineAnchor, setTimelineAnchor] = useState<{
    readonly threadKey: string | null;
    readonly messageId: MessageId | null;
  }>({ threadKey: activeThreadKey, messageId: null });
  if (timelineAnchor.threadKey !== activeThreadKey) {
    setTimelineAnchor({ threadKey: activeThreadKey, messageId: null });
  }
  const timelineAnchorMessageId = timelineAnchor.messageId;
  // LegendList never recomputes anchored end-space geometry, leaving phantom scroll range after content fits.
  const anchorRunSettled = (() => {
    if (timelineAnchorMessageId === null) return false;
    const anchorRun = serverProjection?.runs.find(
      (run) => run.userMessageId === timelineAnchorMessageId,
    );
    if (anchorRun === undefined) return false;
    return (
      anchorRun.status !== "preparing" &&
      anchorRun.status !== "queued" &&
      anchorRun.status !== "starting" &&
      anchorRun.status !== "running" &&
      anchorRun.status !== "waiting"
    );
  })();
  if (anchorRunSettled) {
    setTimelineAnchor({ threadKey: activeThreadKey, messageId: null });
  }
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const [threadPanelPopoverHandle] = useState(PopoverCreateHandle);
  const [chatCanvasStore] = useState(createChatCanvasStore);

  const latestRunSettled = isLatestRunSettled(activeLatestRun, activeRuntime);
  const activeThreadEnvironmentId = activeThread?.environmentId;
  const activeThreadProjectId = activeThread?.projectId;
  const activeProjectRef =
    activeThreadEnvironmentId !== undefined && activeThreadProjectId !== undefined
      ? scopeProjectRef(activeThreadEnvironmentId, activeThreadProjectId)
      : null;
  const activeProject = useProject(activeProjectRef);
  const activeProjectSettings = resolveProjectSettings(
    settings,
    activeProject?.id ?? null,
    activeProject ?? undefined,
  );
  const activeProjectDefaultModelSelection =
    !isServerThread && draftFallback
      ? draftFallback.selection
      : activeProjectSettings.settings.defaultModelSelection;
  const handleNewThreadInActiveProject = () => {
    startNewThreadForProject(activeProjectRef, handleNewThread);
  };
  const handleNewThreadInActiveProjectStable = useStableCallback(handleNewThreadInActiveProject);
  const projectGroupingSettings = selectProjectGroupingSettings(settings);
  const activeDraftLogicalProjectKey =
    !isServerThread && activeProject
      ? deriveLogicalProjectKeyFromSettings(activeProject, projectGroupingSettings)
      : undefined;
  const handleOpenDraftProjectSettings = () => {
    if (!activeDraftLogicalProjectKey) return;
    void navigate({
      to: "/projects/$projectKey",
      params: { projectKey: activeDraftLogicalProjectKey },
    });
  };
  const handleOpenDraftProjectSettingsStable = useStableCallback(handleOpenDraftProjectSettings);
  const activeEnvironment =
    activeThread == null ? null : (environmentById.get(activeThread.environmentId) ?? null);
  const { handlePreparedPullRequestThreadStable, openPullRequestDialogStable } =
    usePullRequestDraftThread({
      routeKind,
      draftId,
      settings,
      projectGroupingSettings,
      activeProject,
      activeThreadKey,
      isServerThread,
      canCheckoutPullRequestIntoThread,
    });
  const serverConfig = activeThread
    ? (activeEnvironment?.serverConfig ?? null)
    : (primaryEnvironment?.serverConfig ?? null);
  const providerEnvironmentId = (activeThread ? activeEnvironment : primaryEnvironment)
    ?.environmentId;
  const providerStatuses =
    (providerEnvironmentId === undefined
      ? undefined
      : providersByEnvironment.get(providerEnvironmentId)) ?? EMPTY_PROVIDERS;
  const selectedProviderByThreadId = composerActiveProvider ?? null;
  const threadProvider =
    activeThread?.modelSelection.instanceId ??
    activeProjectDefaultModelSelection?.instanceId ??
    null;
  const lockedProvider = deriveLockedProvider({
    thread: activeThread,
    selectedProvider: selectedProviderByThreadId,
    threadProvider,
    providers: providerStatuses,
  });
  const modelPickerLockedProvider = supportsProviderSwitchingViaHandoff ? null : lockedProvider;
  const pullRequestsCapabilityKnown = serverConfig !== null;
  const supportsPullRequests = serverConfig !== null;
  const threadStarted = Boolean(activeThread && (activeMessageCount > 0 || activeRuntime !== null));
  const providerInstanceEntries = providerInstanceEntriesFor(
    providerStatuses,
    settings,
    activeProject?.id ?? null,
  );
  const activeThreadModelInstanceId = activeThread?.modelSelection.instanceId;
  const { selectedProviderEntry, requestedDriverKind } = resolveComposerProviderSelection({
    entries: providerInstanceEntries,
    candidateInstanceIds: [
      selectedProviderByThreadId,
      activeRuntime?.providerInstanceId,
      activeThreadModelInstanceId,
      activeProjectDefaultModelSelection?.instanceId,
    ],
    lockedProvider,
    lockedInstanceId: activeRuntime?.providerInstanceId ?? activeThreadModelInstanceId,
  });
  const selectedProvider = selectedProviderEntry?.driverKind ?? requestedDriverKind;
  const activeProviderInstanceId = selectedProviderEntry?.instanceId ?? null;
  const activeProviderStatus = selectedProviderEntry?.snapshot ?? null;
  const conversationProviderStatus =
    providerStatuses.find((status) => status.instanceId === activeRuntime?.providerInstanceId) ??
    activeProviderStatus;
  const supportsConversationRollback =
    canOperateThread &&
    conversationProviderStatus !== null &&
    conversationProviderStatus.supportsConversationRollback !== false;
  const phase = derivePhase(activeRuntime);
  const serverThreadId = serverThread?.id;
  const serverThreadEnvironmentId = serverThread?.environmentId;
  const setThreadError = makeThreadErrorSetter({
    routeThreadRef,
    routeThreadKey,
    draftId,
    serverThreadRef:
      serverThreadId !== undefined && serverThreadEnvironmentId !== undefined
        ? { threadId: serverThreadId, environmentId: serverThreadEnvironmentId }
        : null,
    setLocalServerErrorsByThreadKey,
    setLocalDraftErrorsByDraftId,
  });
  const {
    pendingApprovals,
    pendingUserInputs,
    activePendingApproval,
    activePendingUserInput,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingIsResponding,
    respondingRequestIds,
    onRespondToApproval: onRespondToApprovalStable,
    onDismissUserInput: onDismissUserInputStable,
    onSelectActivePendingUserInputOption: onSelectActivePendingUserInputOptionStable,
    onChangeActivePendingUserInputCustomAnswer,
    onAdvanceActivePendingUserInput,
    onAdvanceActivePendingUserInputStable,
    onPreviousActivePendingUserInputQuestion: onPreviousActivePendingUserInputQuestionStable,
  } = usePendingThreadRequests({
    environmentId,
    activeThreadId,
    serverProjection,
    composerDraftTarget,
    setComposerDraftPrompt,
    promptRef,
    composerRef,
    setThreadError,
  });
  const [heldApprovalRequestIds, setHeldApprovalRequestIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const onHeldRequestIdsChange = useStableCallback((requestIds: ReadonlySet<string>) => {
    setHeldApprovalRequestIds((current) => (shallow(current, requestIds) ? current : requestIds));
  });
  // Answering an approval or question on any client resumes quota spending, so include it in the key.
  const usageLimitsKey =
    activeProviderInstanceId === null || (isServerThread && activeThread === undefined)
      ? null
      : [
          routeThreadKey,
          activeProviderInstanceId,
          activeThread?.latestRun?.runId ?? "",
          activePendingApproval?.requestId ?? activePendingUserInput?.requestId ?? "",
        ].join(":");
  const {
    banner: usageLimitsBanner,
    offered: usageLimitsOffered,
    open: openUsageLimits,
    clearFor: clearUsageLimitsFor,
  } = useUsageLimitsPanel({
    environmentId,
    threadKey: routeThreadKey,
    panelKey: usageLimitsKey,
    providerInstanceId: activeProviderInstanceId,
    providerDriver: activeProviderStatus?.driver ?? null,
    providers: providerStatuses,
    sources: serverConfig?.usageLimitSources ?? EMPTY_USAGE_LIMIT_SOURCES,
  });
  const {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt,
    isSendBusy,
    backgroundSubmissionPending,
  } = useLocalDispatchState({
    activeThread,
    activeLatestRun,
    latestUserMessageId:
      serverProjection?.messages.findLast((message) => message.role === "user")?.id ?? null,
    phase,
    activePendingApproval: activePendingApproval?.requestId ?? null,
    activePendingUserInput: activePendingUserInput?.requestId ?? null,
    threadError,
  });
  const optimisticCompactionMessage = optimisticUserMessages.at(-1);
  const latestServerUserItem = serverVisibleTurnItems.findLast(
    (row) => row.item.type === "user_message",
  )?.item;
  const compactRequestIsActive =
    (isSendBusy &&
      optimisticCompactionMessage !== undefined &&
      isCompactCommandMessage(optimisticCompactionMessage)) ||
    (latestServerUserItem?.type === "user_message" &&
      latestServerUserItem.text.trim().toLowerCase() === "/compact" &&
      latestServerUserItem.attachments.length === 0 &&
      latestServerUserItem.runId === activeActivityRun?.runId &&
      !isLatestRunSettled(activeActivityRun, activeRuntime));
  const compactionSettled = serverVisibleTurnItems.some(
    ({ item }) =>
      item.type === "compaction" &&
      item.runId === activeActivityRun?.runId &&
      (item.status === "completed" ||
        item.status === "failed" ||
        item.status === "interrupted" ||
        item.status === "cancelled"),
  );
  const compactionRunning = serverVisibleTurnItems.some(
    ({ item }) =>
      item.type === "compaction" &&
      item.runId !== null &&
      item.runId === activeRuntime?.activeRunId &&
      item.status === "running",
  );
  const isCompacting =
    (isSendBusy || phase === "connecting" || phase === "running") &&
    (compactionRunning || (compactRequestIsActive && !compactionSettled));
  const isWorking =
    phase === "running" || isSendBusy || isCompacting || runlessWorkStartedAt !== null;
  const activeContextWindow = deriveLatestContextWindowSnapshot(
    serverVisibleTurnItems ?? [],
    activeThreadLiveTokenUsage,
    activeProviderThread,
  );
  const pendingBackgroundTasks = deriveThreadPendingBackgroundTasks(serverProjection);
  const activeWorkStartedAt =
    deriveActiveWorkStartedAt(activeActivityRun, activeRuntime, localDispatchStartedAt) ??
    runlessWorkStartedAt;
  const activeRunPreparing = activeActivityRun?.status === "preparing";
  const sendQueuesBehindSetup =
    isServerThread && (activeRunPreparing || activeActivityRun?.status === "starting");
  const [setupQueueSendThreadKey, setSetupQueueSendThreadKey] = useState<string | null>(null);
  const downloadFileAttachment = async (attachment: ChatFileAttachment) => {
    const connection = readPreparedConnection(environmentId);
    if (!connection) {
      toastManager.add({ type: "error", title: "The environment is not connected." });
      return;
    }

    try {
      const url = await resolveFileAttachmentUrl({
        attachment,
        environmentId,
        httpBaseUrl: connection.httpBaseUrl,
        createAssetUrl: createAttachmentAssetUrl,
      });
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.name;
      anchor.click();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not download " + attachment.name,
        description: error instanceof Error ? error.message : "The attachment is unavailable.",
      });
    }
  };
  const downloadFileAttachmentStable = useStableCallback(downloadFileAttachment);
  // kuru code has no file viewer panel, so opening an attachment saves it.
  const openFileAttachmentStable = downloadFileAttachmentStable;
  const { timelineAttachmentUrlById } = useAttachmentPreviewHandoff({
    environmentId,
    threadId,
    serverVisibleTurnItems,
    handoff: optimisticState.handoff,
    blobPreviews: optimisticBlobPreviews,
    setOptimisticUserMessages: setHeldOptimisticUserMessages,
  });
  const timelineEntriesInput = {
    optimisticMessages: optimisticUserMessages,
    attachmentUrlById: timelineAttachmentUrlById,
    ...(serverProjection === null
      ? {}
      : {
          attempts: serverProjection.attempts,
          nodes: serverProjection.nodes,
          plans: serverProjection.plans,
        }),
  };
  // The structure has no assistant or reasoning text, so those rows stay out of
  // ChatView's own entries (anchoring, rewind, prompt history); ThreadTimeline
  // renders every row from the live turn items.
  const serverTimelineRows = serverVisibleTurnItems.filter(isCompleteTurnItemRow);
  const hasStreamedTimelineRows =
    isServerThread && serverTimelineRows.length !== serverVisibleTurnItems.length;
  const serverTimelineEntries = useIncrementalTimelineEntries(activeThreadKey, {
    ...timelineEntriesInput,
    visibleTurnItems: serverTimelineRows,
  });
  const draftTimelineEntries = optimisticUserMessages.map(
    (message) =>
      ({
        id: message.id,
        kind: "message",
        createdAt: message.createdAt,
        message,
      }) as const,
  );
  const timelineEntries = isServerThread ? serverTimelineEntries : draftTimelineEntries;
  const timelineMessages = timelineEntries.flatMap((entry) =>
    entry.kind === "message" ? [entry.message] : [],
  );
  const timelineEmpty = timelineEntries.length === 0 && !hasStreamedTimelineRows;
  const displayedTimelineKey = activeThreadKey ?? routeThreadKey;
  const displayedThreadRef = parseScopedThreadKey(displayedTimelineKey);
  const [dockedDraftHeroThreadKey, setDockedDraftHeroThreadKey] = useState<string | null>(null);
  const draftHeroDockRequested =
    activeThreadKey !== null && dockedDraftHeroThreadKey === activeThreadKey;
  const isDraftHeroState = resolveDraftHeroState({
    isLocalDraftThread,
    hasTimelineEntries: !timelineEmpty,
    isWorking,
    draftHeroDockRequested,
    backgroundSubmissionPending,
  });
  const {
    transitionGroupRef: draftHeroTransitionGroupRef,
    composerAnchorRef: draftHeroComposerAnchorRef,
    captureComposerRect: captureDraftHeroComposerRect,
  } = useDraftHeroLayoutTransition(
    isDraftHeroState,
    panelAnimationsActive,
    panelAnimationDurationMs,
  );
  const turnDiffSummaries = useThreadCheckpointSummaries(routeThreadDetailRef);
  const availableRevertTurnCounts = deriveAvailableRevertTurnCounts(serverProjection);
  // A paged history window cannot identify the first loaded run as the thread start.
  const threadStartCheckpointReady =
    !serverThreadHistory.hasMoreHistory &&
    findRevertCheckpoint(serverProjection?.checkpoints ?? [], 0) !== undefined;

  const workspaceMutationId = deriveWorkspaceMutationId(
    serverVisibleTurnItems,
    turnDiffSummaries.at(-1)?.completedAt ?? null,
  );

  const gitCwd = activeProject
    ? (activeThread?.worktreePath ?? activeProject.workspaceRoot)
    : null;
  const gitStatusCwd = activeThread?.worktreePath ?? gitCwd;
  const gitStatusAtom =
    gitStatusCwd === null
      ? null
      : vcsEnvironment.status({
          environmentId,
          input: { cwd: gitStatusCwd },
        });
  const gitStatusQuery = {
    data: useAtomValue(gitStatusAtom ? chatGitStatusAtom(gitStatusAtom) : NO_CHAT_GIT_STATUS_ATOM),
    refresh: useEnvironmentQueryRefresh(gitStatusAtom).refresh,
  };
  useWorkspaceMutationRefresh({
    enabled: gitStatusCwd !== null,
    mutationId: workspaceMutationId,
    refresh: gitStatusQuery.refresh,
    resourceKey: `git-status:${activeThreadKey ?? ""}:${gitStatusCwd ?? ""}`,
  });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const backgroundThread = use(BackgroundThreadContext);
  const manualCompactionProviderAvailable = hasAvailableCompactionProvider({
    providers: providerInstanceEntries,
    driverKind: selectedProvider,
    instanceId: activeProviderInstanceId,
    lockedInstanceId: lockedProvider
      ? (activeRuntime?.providerInstanceId ?? activeThread?.modelSelection.instanceId ?? null)
      : null,
  });
  const [resumeCompactionPermanentlyDismissed, setResumeCompactionPermanentlyDismissed] =
    useLocalStorage(
      `t3code:resume-compaction-dismissed:${environmentId}:${activeProviderInstanceId ?? "claudeAgent"}`,
      false,
      Schema.Boolean,
    );
  const nativeResumeCompactionDismissed = hasDismissedResumeCompaction(
    (serverProjection?.runtimeRequests ?? [])
      .filter((request) => request.kind === "user_input" && request.status === "resolved")
      .map((request) => ({
        kind: "user-input.resolved",
        payload: { answers: request.answers },
      })),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persists the server-reported resume compaction dismissal to localStorage
  useEffect(() => {
    if (nativeResumeCompactionDismissed && !resumeCompactionPermanentlyDismissed) {
      setResumeCompactionPermanentlyDismissed(true);
    }
  }, [
    nativeResumeCompactionDismissed,
    resumeCompactionPermanentlyDismissed,
    setResumeCompactionPermanentlyDismissed,
  ]);
  const [dismissedFallbackWindow, setDismissedFallbackWindow] = useLocalStorage(
    `t3code:fallback-notice-dismissed:${environmentId}`,
    null,
    DismissedFallbackWindowSchema,
  );
  const providerStatusBannerKey = getProviderStatusBannerKey(activeProviderStatus);
  const [dismissedProviderStatusBannerKey, setDismissedProviderStatusBannerKey] = useState<
    string | null
  >(null);
  if (providerStatusBannerKey === null && dismissedProviderStatusBannerKey !== null) {
    setDismissedProviderStatusBannerKey(null);
  }
  const visibleProviderStatus = shouldShowProviderStatusBanner(
    activeProviderStatus,
    dismissedProviderStatusBannerKey,
  )
    ? activeProviderStatus
    : null;
  const hasTimelineTopBanner = Boolean(timelineThreadError) || visibleProviderStatus !== null;
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const activeThreadWorktreePath = activeThread?.worktreePath ?? null;
  const activeWorkspaceRoot = activeThreadWorktreePath ?? activeProjectCwd ?? undefined;
  const liveIsGitRepo = gitStatusQuery.data?.isRepo;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records live git repo status in the session cache read while the status query is unavailable
  useEffect(() => {
    if (gitStatusCwd !== null && liveIsGitRepo !== undefined) {
      rememberCheckoutIsRepo(environmentId, gitStatusCwd, liveIsGitRepo);
    }
  }, [environmentId, gitStatusCwd, liveIsGitRepo]);
  const isGitRepo = liveIsGitRepo ?? recallCheckoutIsRepo(environmentId, gitStatusCwd) ?? true;
  // Provider-native subagents cannot take messages; approvals and questions go to the top-level parent.
  const showProviderSubagentBar = isProviderSubagent;
  const composerMounted = !showProviderSubagentBar;
  const providerSubagentModels = selectedProviderEntry?.models ?? EMPTY_PROVIDER_MODELS;
  // Providers can report dated model ids or aliases.
  const providerSubagentModelSlug = selectedProviderEntry
    ? resolveSelectableModel(
        selectedProviderEntry.driverKind,
        activeThread?.modelSelection.model,
        providerSubagentModels,
      )
    : null;
  const providerSubagentCatalogModel = providerSubagentModels.find(
    (model) => model.slug === providerSubagentModelSlug,
  );
  const providerSubagentModelLabel = providerSubagentCatalogModel
    ? getTriggerDisplayModelName(providerSubagentCatalogModel, selectedProviderEntry?.driverKind)
    : formatModelSlugName(activeThread?.modelSelection.model ?? "");
  const providerSubagentEffortLabel =
    activeThread === undefined
      ? null
      : formatModelSelectionEffort(
          activeThread.modelSelection,
          providerSubagentModels,
          reportedModelSelection,
        );
  const showComposerContextStrip =
    shouldShowComposerContextStrip({
      isDraftHeroState,
      persistInActiveThreads: settings.persistComposerContextStrip,
      hasActiveProject: activeProject !== null && !showProviderSubagentBar,
      isGitRepo,
    });
  const focusComposer = () => {
    composerRef.current?.focusAtEnd();
  };
  const focusComposerStable = useStableCallback(focusComposer);
  const canInterruptRunningThread =
    canOperateThread && deriveCanInterruptRunningThread(activeThread !== undefined, activeRuntime);
  const onInterrupt = async () => {
    if (
      !activeThread ||
      !readEnvironmentScope(activeThread.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const result = await interruptThreadTurn({
      environmentId,
      input: { threadId: activeThread.id },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setThreadError(
        activeThread.id,
        error instanceof Error ? error.message : "Failed to interrupt the current turn.",
      );
    }
  };
  const onInterruptStable = useStableCallback(onInterrupt);
  const scheduleComposerFocus = () => {
    window.requestAnimationFrame(() => {
      // The model picker stays open through its own changes, so it keeps focus.
      if (!isModelPickerOpen()) focusComposer();
    });
  };
  const scheduleComposerFocusStable = useStableCallback(scheduleComposerFocus);
  const queuedRunsControlRef = useRef<QueuedRunsControlHandle>(null);

  const threadPanelInlineOpen = useThreadPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, activeThreadRef, "inline"),
  );
  // Selects only the mode, so canvas resizes rerender the chat view only when the
  // card switches presentation.
  const threadPanelPresentation = useStore(
    chatCanvasStore,
    (state) =>
      resolveChatCanvasModel({
        measurements: state.measurements,
        detailsCardMeasurement: state.detailsCardMeasurement,
        threadRef: activeThreadRef,
        detailsCardInlineOpen: threadPanelInlineOpen,
      }).detailsCardMode,
  );
  const threadPanelOpen = useThreadPanelStore((state) =>
    selectThreadPanelOpen(
      state.threadPanelVisibilityByThreadKey,
      activeThreadRef,
      threadPanelPresentation,
    ),
  );
  const toggleThreadPanel = () => {
    if (!activeThreadRef) return;
    const store = useThreadPanelStore.getState();
    if (threadPanelPresentation === "inline") {
      const open = selectThreadPanelOpen(
        store.threadPanelVisibilityByThreadKey,
        activeThreadRef,
        "inline",
      );
      if (!open) requestWorkspaceFocus({ area: "details" });
      else if (document.activeElement?.closest('[data-workspace-area="details"]'))
        requestWorkspaceContentFocus();
    }
    store.toggleThreadPanel(activeThreadRef, threadPanelPresentation);
  };
  const toggleThreadPanelStable = useStableCallback(toggleThreadPanel);
  const supportsThreadPullRequests = serverConfig !== null;
  const visiblePullRequests = visibleThreadPullRequests(
    (activeThreadShell ?? activeThread)?.pullRequests ?? [],
  );
  const visiblePullRequestCount = visiblePullRequests.length;
  const pullRequestsSurfaceAvailable =
    isServerThread && supportsThreadPullRequests && visiblePullRequestCount > 0;
  // The thread's own change request, placed against the project it belongs to. Without a
  // project there is nothing to resolve it against, so the caller falls back to the browser.
  const activeProjectRepository = sourceControlClients.repositorySelector(
    activeProject?.repositoryIdentity,
  );
  const { linked: linkedThreadPullRequest } = useThreadLinkedPullRequest({
    serverThreadRef: isServerThread ? activeThreadRef : null,
    environmentId: activeThreadRef?.environmentId ?? null,
    persisted: isServerThread
      ? (activeThreadShell?.linkedPullRequest ?? activeThread?.linkedPullRequest ?? null)
      : (activeThread?.linkedPullRequest ?? null),
    projectId: activeProject?.id ?? null,
    projectRepository: activeProjectRepository,
    threadBranch: activeThread?.branch ?? null,
    gitStatus: gitStatusQuery.data ?? null,
  });
  const activeRunningTurnId = activeRuntime?.activeRunId ?? null;
  const persistThreadSettingsForNextTurn = async (input: {
    threadId: ThreadId;
    createdAt: string;
    branch?: string;
  }): Promise<AtomCommandResult<void, unknown>> => {
    if (!serverThread) {
      return AsyncResult.success(undefined);
    }

    let result: AtomCommandResult<void, unknown> = AsyncResult.success(undefined);
    const metadataUpdate = resolveThreadMetadataUpdateForNextTurn({
      currentModelSelection: serverThread.modelSelection,
      currentBranch: serverThread.branch,
      ...(input.branch ? { nextBranch: input.branch } : {}),
    });
    if (metadataUpdate) {
      result = mapAtomCommandResult(
        await updateThreadMetadata({
          environmentId,
          input: {
            threadId: input.threadId,
            ...metadataUpdate,
          },
        }),
        () => undefined,
      );
      if (result._tag === "Failure") {
        return result;
      }
    }

    return result;
  };

  const {
    showScrollToBottom,
    timelineLiveFollowEnabled,
    onComposerPageScrollKeyDownStable,
    onComposerPageScrollKeyUpStable,
    onComposerPageScrollReleaseStable,
    scrollToEnd,
    onTimelineAnchorReadyStable,
    onTimelineAnchorSizeChangedStable,
    onTimelineFooterGrowStable,
    onIsAtEndChangeStable,
    anchorNewTurn,
    attachTimelineViewport,
    attachComposerOverlay: attachFollowComposerOverlay,
  } = useTimelineFollow({
    legendListRef,
    composerTimelineInset,
    routeThreadKey,
    activeThreadKey,
    isServerThread,
    serverProjection,
    threadStatus,
    activeActivityRun,
    activeRunningTurnId,
    timelineEntries,
    timelineAnchorMessageId,
    setTimelineAnchor,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- schedules a frame to focus the composer DOM element when a thread opens
  useEffect(() => {
    if (!activeThread?.id) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposerStable();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposerStable]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window focus listener that refocuses the composer after the window regains focus
  useEffect(() => {
    if (!activeThread?.id || isMobileViewport) return;
    let frame: number | null = null;
    const onWindowFocus = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      // Wait an extra frame after window focus so the composer treats focus as an expansion request.
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          frame = null;
          if (document.querySelector("[data-mcp-app-fullscreen]") !== null) return;
          if (shouldRefocusComposerOnWindowFocus(document.activeElement)) {
            focusComposerStable();
          }
        });
      });
    };
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposerStable, isMobileViewport]);

  // Promotion drops draftId while a send may still be dispatching, so key by thread.
  const [localDispatchThreadId, setLocalDispatchThreadId] = useState(threadId);
  if (localDispatchThreadId !== threadId) {
    setLocalDispatchThreadId(threadId);
    resetLocalDispatch();
  }

  const activeWorktreePath = activeThread?.worktreePath ?? null;
  const canOverrideServerThreadBranch = Boolean(
    isServerThread && activeThread && activeMessageCount === 0 && !threadStarted,
  );
  if (!canOverrideServerThreadBranch && pendingServerThreadBranchEntry !== null) {
    setPendingServerThreadBranchEntry(null);
  }
  const pendingServerThreadBranchEntryForThread =
    pendingServerThreadBranchEntry?.threadId === activeThread?.id
      ? pendingServerThreadBranchEntry
      : null;
  const setPendingServerThreadBranch = (branch: string | null) => {
    if (activeThread) setPendingServerThreadBranchEntry({ threadId: activeThread.id, branch });
  };
  const activeThreadBranch =
    canOverrideServerThreadBranch && pendingServerThreadBranchEntryForThread !== null
      ? pendingServerThreadBranchEntryForThread.branch
      : (activeThread?.branch ?? null);
  const localCheckoutBranchMismatch = isServerThread
    ? resolveLocalCheckoutBranchMismatch({
        activeWorktreePath,
        activeThreadBranch,
        currentGitBranch: gitStatusQuery.data?.refName ?? null,
      })
    : null;

  const publishComposerOverlayHeight = (height: number) => {
    const nextHeight = Math.ceil(height);
    if (nextHeight <= 0) return;
    if (composerTimelineInsetRef.current !== nextHeight) {
      composerTimelineInsetRef.current = nextHeight;
      setComposerTimelineInset(nextHeight);
    }
    // Reserve the expanded composer height for the empty placeholder.
    // Keep it while the mobile strip collapses, but allow growth from approvals or tasks.
    // A hero overlay fills the pane, so reserve only its stack.
    const stack = composerOverlayElement?.querySelector<HTMLElement>(
      '[data-chat-composer-stack="true"]',
    );
    const expandedComposerHeight =
      isDraftHeroState && stack ? Math.ceil(stack.getBoundingClientRect().height) : nextHeight;
    const mobileCollapsed = Boolean(
      stack?.querySelector('[data-chat-composer-mobile-collapsed="true"]'),
    );
    if (!mobileCollapsed) composerExpandedHeightRef.current = expandedComposerHeight;
    const reservedHeight = Math.max(composerExpandedHeightRef.current, expandedComposerHeight);
    if (composerReservedHeightRef.current !== reservedHeight) {
      composerReservedHeightRef.current = reservedHeight;
      setComposerReservedHeight(reservedHeight);
    }
    const mainSurface = composerOverlayElement?.querySelector<HTMLElement>(
      '[data-chat-composer-main-surface="true"]',
    );
    const button =
      composerOverlayElement?.parentElement?.querySelector<HTMLElement>("[data-scroll-to-end]");
    const clearance =
      composerOverlayElement && mainSurface && button
        ? resolveScrollToEndClearance({
            overlayHeight: nextHeight,
            mainSurfaceTop: mainSurface.getBoundingClientRect().top,
            button: button.getBoundingClientRect(),
            attachments: Array.from(
              composerOverlayElement.querySelectorAll<HTMLElement>(
                '[data-composer-banner-surface="attached"]',
              ),
              (element) => element.getBoundingClientRect(),
            ),
          })
        : nextHeight;
    setScrollToEndClearance(clearance);
  };
  const publishComposerOverlayHeightStable = useStableCallback(publishComposerOverlayHeight);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the composer overlay element before paint for a new thread or composer mount
  useLayoutEffect(() => {
    if (!composerOverlayElement) return;
    composerTimelineInsetRef.current = 0;
    composerReservedHeightRef.current = 0;
    composerExpandedHeightRef.current = 0;
    publishComposerOverlayHeightStable(composerOverlayElement.getBoundingClientRect().height);
  }, [
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A thread switch or a composer mount/unmount must re-measure the overlay for the new timeline.
    activeThreadKey,
    composerMounted,
    composerOverlayElement,
    publishComposerOverlayHeightStable,
  ]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes the composer overlay element's size before paint and publishes its height
  useLayoutEffect(() => {
    if (!composerOverlayElement) return;

    const updateHeight = () => {
      publishComposerOverlayHeightStable(composerOverlayElement.getBoundingClientRect().height);
    };

    updateHeight();
    // The hero overlay fills the pane, so the composer's own growth only shows on its stack.
    const stack = isDraftHeroState
      ? composerOverlayElement.querySelector<HTMLElement>('[data-chat-composer-stack="true"]')
      : null;
    return observeResize(
      stack ? [composerOverlayElement, stack] : composerOverlayElement,
      updateHeight,
    );
  }, [
    composerOverlayElement,
    isDraftHeroState,
    publishComposerOverlayHeightStable,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The scroll-to-bottom button changes the overlay's height without resizing the observed node first.
    showScrollToBottom,
  ]);
  const activeThreadReferenceCopyTarget =
    activeThreadRef === null || !isServerThread
      ? null
      : resolveThreadReferenceCopyTarget({
          threadRef: activeThreadRef,
          title: activeThread?.title ?? "",
        });
  const copyActiveThreadReference = () => {
    if (activeThreadReferenceCopyTarget === null) return;
    void copyThreadReference(activeThreadReferenceCopyTarget);
  };
  const {
    activeBranchMismatchKey,
    attentionNow,
    workNow,
    childInputNow,
    goalNow,
    handleSwitchCheckoutToThread,
    handleSwitchCheckoutToThreadStable,
    isRestoringThreadBranch,
    onOpenRelatedThreadStable,
    sendStandaloneCommand,
    setBranchMismatchDismissTick,
    showBranchMismatchBanner,
    threadStatusLine,
    shortcuts: threadLifecycleShortcuts,
  } = useThreadLifecycle({
    environmentId,
    routeThreadKey,
    currentRouteThreadKeyRef,
    canOperateThread,
    clientSettingsHydrated,
    activeThread,
    activeThreadId,
    activeThreadRef,
    threadDetailRef: routeThreadDetailRef,
    activeThreadKey,
    activeThreadShell,
    activeLatestRun,
    activeProjectCwd,
    serverConfig,
    runtimeMode,
    isWorking,
    pendingBackgroundTasks,
    turnItems: serverProjection?.turnItems ?? EMPTY_TURN_ITEMS,
    activePendingApproval,
    activePendingUserInput,
    localCheckoutBranchMismatch,
    gitStatusQuery,
    nowMinute,
    composerRef,
    composerDraftTarget,
    sendInFlightRef,
    setOptimisticUserMessages,
    setThreadError,
    clearUsageLimitsFor,
    beginLocalDispatch,
    resetLocalDispatch,
    scrollToEnd,
    persistThreadSettingsForNextTurn,
  });
  const activeThreadHasCompactableConversation = serverVisibleTurnItems.some(
    ({ item }) =>
      item.type === "user_message" &&
      (item.text.trim().toLowerCase() !== "/compact" || item.attachments.length > 0),
  );
  const pendingHandoffSelection = composerSelectedModelSelection ?? activeThread?.modelSelection;
  const pendingHandoffSelectionUsable = providerInstanceEntries.some(
    (entry) =>
      entry.instanceId === pendingHandoffSelection?.instanceId &&
      entry.enabled &&
      entry.isAvailable,
  );
  const pendingHandoff = resolvePendingHandoff(
    serverProjection,
    pendingHandoffSelectionUsable ? pendingHandoffSelection : null,
    providerStatuses,
  );
  const compactThreadUnavailable =
    !canOperateThread ||
    !activeThread ||
    !activeThreadHasCompactableConversation ||
    !activeProject ||
    !isServerThread ||
    !manualCompactionProviderAvailable ||
    isWorking ||
    isRevertingCheckpoint ||
    threadDetailLoading ||
    pendingApprovals.length > 0 ||
    pendingUserInputs.length > 0;
  const compactDisabled = compactThreadUnavailable;
  const resumeCompactionTokens =
    activeContextWindow &&
    resolveIdleCompaction(
      settings,
      activeProviderInstanceId ?? ProviderInstanceId.make("claudeAgent"),
    ) !== "off" &&
    !resumeCompactionPermanentlyDismissed &&
    !nativeResumeCompactionDismissed &&
    !compactDisabled &&
    !hasHeldQueuedRuns &&
    shouldOfferResumeCompaction({
      provider: selectedProvider,
      usedTokens: activeContextWindow.usedTokens,
      updatedAt: activeContextWindow.updatedAt,
      promptCacheTtlMs: activeThreadLiveTokenUsage?.promptCacheTtlMs,
      now: `${nowMinute}:00.000Z`,
    })
      ? activeContextWindow.usedTokens
      : null;
  const [fullHistoryThreadKeys, setFullHistoryThreadKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const keepFullHistory = fullHistoryThreadKeys.has(routeThreadKey);
  const setKeepFullHistory = (threadKey: string, keep: boolean) => {
    setFullHistoryThreadKeys((current) => {
      if (current.has(threadKey) === keep) return current;
      const next = new Set(current);
      if (keep) next.add(threadKey);
      else next.delete(threadKey);
      return next;
    });
  };
  const freshSessionAvailable =
    activeMessageCount > 0 && serverConfig?.environment.capabilities.freshContext === true;
  // While a question or approval owns the composer, its text answers that, not the agent.
  const freshSessionCommandAvailable =
    freshSessionAvailable && activePendingApproval === null && pendingUserInputs.length === 0;
  const freshSessionArmed = useFreshSessionArmed(routeThreadKey);
  const toggleKeepFullHistory = () => setKeepFullHistory(routeThreadKey, !keepFullHistory);
  const toggleKeepFullHistoryStable = useStableCallback(toggleKeepFullHistory);
  const armFreshSessionStable = useStableCallback(() => armFreshSession(routeThreadKey));
  const handleRestoreThreadBranch = () => {
    if (!canWriteSourceControl) return;
    if (gitStatusQuery.data?.hasWorkingTreeChanges) {
      if (activeThreadKey !== null) openBranchRestoreConfirm(activeThreadKey);
      return;
    }
    void handleSwitchCheckoutToThread();
  };
  const handleRestoreThreadBranchStable = useStableCallback(handleRestoreThreadBranch);
  const composerBannerItems = (() => {
    const fallbackSelection = draftFallback?.selection;
    const defaultSelection =
      draftDefaultModelSelection ??
      resolveProjectDefaultProviderModelSelection(
        providerStatuses,
        settings,
        draftThread?.projectId ?? null,
      );
    const fallback =
      !isServerThread &&
        !composerModelSelectionExplicit &&
      draftFallback?.fallback &&
      (!composerSelectedModelSelection ||
        (composerSelectedModelSelection.instanceId === fallbackSelection?.instanceId &&
          composerSelectedModelSelection.model === fallbackSelection?.model))
        ? draftFallback.fallback
        : null;
    const fallbackWindow = fallback
      ? `${fallback.provider.instanceId}:${fallback.resetsAt ?? ""}`
      : null;
    const fallbackItems: ComposerBannerStackItem[] =
      fallback &&
      fallbackSelection &&
      defaultSelection &&
      fallbackWindow !== dismissedFallbackWindow
        ? [
            modelFallbackBannerItem({
              fallbackModelName:
                providerStatuses
                  .find((provider) => provider.instanceId === fallbackSelection.instanceId)
                  ?.models.find((model) => model.slug === fallbackSelection.model)?.name ??
                fallbackSelection.model,
              defaultProviderName: fallback.provider.displayName ?? fallback.provider.driver,
              defaultModelName:
                fallback.provider.models.find((model) => model.slug === defaultSelection.model)
                  ?.name ?? defaultSelection.model,
              resetsAt: fallback.resetsAt,
              timestampFormat,
              onUseDefault: () =>
                onProviderModelSelectStable(defaultSelection.instanceId, defaultSelection.model),
              onDismiss: () => setDismissedFallbackWindow(fallbackWindow),
            }),
          ]
        : [];
    const extensionStatusBanner = extensionStatusBannerItem(
      deriveProviderExtensionStatuses(serverProjection),
    );
    const extensionStatusItems = extensionStatusBanner === null ? [] : [extensionStatusBanner];
    const usageLimitsItems = usageLimitsBanner === null ? [] : [usageLimitsBanner];
    // An approval's feedback goes to that approval; the armed session waits for the next message.
    const freshSessionItems =
      freshSessionAvailable && freshSessionArmed && activePendingApproval === null
        ? [freshSessionBannerItem(() => disarmFreshSession(routeThreadKey))]
        : [];
    if (!localCheckoutBranchMismatch || !showBranchMismatchBanner || !activeBranchMismatchKey) {
      return [...fallbackItems, ...extensionStatusItems, ...usageLimitsItems, ...freshSessionItems];
    }
    return [
      ...fallbackItems,
      ...extensionStatusItems,
      ...usageLimitsItems,
      ...freshSessionItems,
      branchMismatchBannerItem({
        mismatchKey: activeBranchMismatchKey,
        mismatch: localCheckoutBranchMismatch,
        restoreDisabled: !canWriteSourceControl || isRestoringThreadBranch,
        restoring: isRestoringThreadBranch,
        onRestore: handleRestoreThreadBranchStable,
        onDismiss: () => {
          dismissBranchMismatchForSession(activeBranchMismatchKey);
          setBranchMismatchDismissTick((tick) => tick + 1);
        },
      }),
    ];
  })() as ComposerBannerStackItem[];

  const getShortcutContext = (eventTarget: EventTarget | null = document.activeElement) => ({
    editableFocus: isEditableFocused(eventTarget),
    modelPickerOpen: composerRef.current?.isModelPickerOpen() ?? false,
    composerFocus: document.activeElement?.getAttribute("data-testid") === "composer-editor",
    draftThreadRoute: routeKind === "draft",
    turnRunning: phase === "running",
    composerRequiresModifier: composerRequiresModifier(settings.sendShortcut, promptRef.current),
    isWeb: !isElectron,
    isDesktop: isElectron,
  });
  const getShortcutContextStable = useStableCallback(getShortcutContext);
  const timelineSkills = activeProviderStatus
    ? resolveProviderSkillsForCwd(activeProviderStatus, gitCwd)
    : EMPTY_PROVIDER_SKILLS;
  const threadFindEnabled = isServerThread && serverConfig?.threadFind === true;
  const isThreadFindActive = useThreadFindOpen(activeThreadRef, threadFindEnabled);
  const openThreadFindStable = useStableCallback((threadRef: ScopedThreadRef) => {
    if (threadFindEnabled && scopedThreadKey(threadRef) === activeThreadKey) {
      openThreadFind(activeThreadKey);
    }
  });

  useChatShortcuts({
    enabled: activeThreadId !== null && !backgroundThread,
    keybindings,
    getShortcutContext,
    threadFindActive: isThreadFindActive,
    composerRef,
    branchToolbarRef,
    closeThreadFind: () => {
      closeThreadFind();
      focusComposerStable();
    },
    commands: {
      ...threadLifecycleShortcuts,
      "threadPanel.toggle": () => toggleThreadPanel(),
      "thread.copyReference": ({ event }) => {
        if (!event.repeat) copyActiveThreadReference();
      },
      "chat.find": () => {
        if (!isServerThread || serverConfig?.threadFind !== true || activeThreadKey === null)
          return false;
        openThreadFind(activeThreadKey);
      },
      "thread.steerQueuedMessage": ({ event }) =>
        routeKind !== "draft" && queuedRunsControlRef.current?.steerNext(event.repeat) === true,
      "thread.editQueuedMessage": ({ event }) =>
        routeKind !== "draft" &&
        composerRef.current?.isCaretAtStart() === true &&
        queuedRunsControlRef.current?.editLatest(event.repeat) === true,
      "thread.stop": ({ event }) => {
        if (!canInterruptRunningThread) return false;
        if (!event.repeat) void onInterruptStable();
      },
    },
  });

  usePasteToFocusComposer(activeThreadId, composerRef);
  const { onConfirmRevertStable, onRevertTimelineTurnStable } =
    useTimelineRewind({
      environmentId,
      routeThreadRef,
      routeThreadKey,
      currentRouteThreadKeyRef,
      serverProjection,
      activeThread,
      timelineMessages,
      phase,
      isSendBusy,
      isRevertingCheckpoint,
      supportsConversationRollback,
      promptRef,
      composerRef,
      composerDraftTarget,
      setThreadError,
    });
  const onCompactContext = () => {
    if (compactDisabled) return;
    void sendStandaloneCommand("/compact", "Failed to compact context.");
  };

  const {
    getModelDisabledReason,
    onProviderModelSelectStable,
    openProviderSetupStable,
  } = useComposerSelection({
    composerDraftTarget,
    draftThread,
    activeThread,
    activeRuntime,
    settings,
    providerStatuses,
    lockedProvider,
    supportsProviderSwitchingViaHandoff,
    isLocalDraftThread,
    scheduleComposerFocus,
  });
  const { onResume, isResuming } = useComposerResume({
    environmentId,
    routeThreadKey,
    currentRouteThreadKeyRef,
    activeThread,
    resumableRunId,
    hasHeldQueuedRuns,
    isSendBusy,
    isRevertingCheckpoint,
    threadDetailLoading,
    runtimeMode,
    localCheckoutBranchMismatch,
    composerRef,
    persistThreadSettingsForNextTurn,
    clearUsageLimitsFor,
    scrollToEnd,
    setThreadError,
  });
  const { onSend } = useComposerSend({
    environmentId,
    routeThreadKey,
    currentRouteThreadKeyRef,
    draftId,
    draftThread,
    activeThread,
    activeThreadKey,
    activeThreadBranch,
    activeProject,
    activeProjectDefaultModelSelection,
    isServerThread,
    isLocalDraftThread,
    phase,
    runtimeMode,
    localCheckoutBranchMismatch,
    providerInstanceEntries,
    composerRef,
    composerDraftTarget,
    promptRef,
    composerImagesRef,
    composerFilesRef,
    queuedRunEdit,
    isRevertingCheckpoint,
    threadDetailLoading,
    isSendBusy,
    sendQueuesBehindSetup,
    isDraftHeroState,
    panelAnimationsActive,
    panelAnimationDurationMs,
    keepFullHistory,
    freshSessionAvailable: freshSessionCommandAvailable,
    resumeCompactionTokens,
    clearUsageLimitsFor,
    pendingApprovals,
    respondingRequestIds,
    activePendingProgress,
    onAdvanceActivePendingUserInput,
    onRespondToApproval: onRespondToApprovalStable,
    beginLocalDispatch,
    resetLocalDispatch,
    captureDraftHeroComposerRect,
    setDockedDraftHeroThreadKey,
    setSetupQueueSendThreadKey,
    setOptimisticUserMessages,
    optimisticBlobPreviews: {
      track: (message) => optimisticBlobPreviews.track(threadId, message),
      release: (message) => optimisticBlobPreviews.release(threadId, message),
    },
    setThreadError,
    setKeepFullHistory,
    anchorNewTurn,
    handleNewThreadInActiveProject,
    persistThreadSettingsForNextTurn,
  });

  const onComposerSendStable = useStableCallback(onSend);
  const onComposerResumeStable = useStableCallback(onResume);
  const onComposerCompactContextStable = useStableCallback(onCompactContext);
  const queuedRunsControl =
    isServerThread && activeThread ? (
      <>
        <QueuedRunsControl
          ref={queuedRunsControlRef}
          steerShortcutLabel={shortcutLabelForCommand(keybindings, "thread.steerQueuedMessage")}
          editShortcutLabel={shortcutLabelForCommand(keybindings, "thread.editQueuedMessage", {
            context: { composerFocus: true },
          })}
          environmentId={activeThread.environmentId}
          threadId={activeThread.id}
          optimisticMessages={optimisticUserMessages}
          editingRunId={queuedRunEdit.editingRunId}
          editBlockedReason={queuedRunEditBlockedReason({
            openQuestionCount: pendingUserInputs.length,
          })}
          onEditQueuedRun={queuedRunEdit.beginEdit}
          onCancelEdit={queuedRunEdit.cancelEdit}
          timestampFormat={timestampFormat}
        />
      </>
    ) : null;
  const onExpandTimelineImage = (preview: ExpandedImagePreview) => {
    openExpandedImagePreview(routeThreadKey, preview);
  };
  const onExpandTimelineImageStable = useStableCallback(onExpandTimelineImage);
  const shownThreadSyncPhase = delayedThreadSyncPhase;
  const hasThreadNow =
    attentionNow !== null || workNow !== null || goalNow !== null || shownThreadSyncPhase !== null;
  const queuedRunCount = serverProjection ? getUserQueuedThreadRuns(serverProjection).length : 0;
  // The queue control is mounted for every server thread but joins the footer only while it shows
  // something, by its own rule: an optimistic message stops counting once the server has it.
  const hasQueuedTurns =
    queuedRunCount > 0 ||
    optimisticUserMessages.some(
      (message) =>
        message.inputIntent === "queued_turn" &&
        !serverProjection?.messages.some((committed) => committed.id === message.id),
    );
  const scrollToEndSummary =
    [childInputNow?.waitingLabel ?? null, queuedRunCount === 0 ? null : `${queuedRunCount} queued`]
      .filter((part) => part !== null)
      .join(" · ") || null;
  // The end of the timeline holds the thread's present and next turns: what it is doing now,
  // its lifecycle status, then your queued messages.
  const timelineFooter =
    pendingHandoff === null && !hasThreadNow && threadStatusLine === null && !hasQueuedTurns ? null : (
      <>
        {pendingHandoff === null ? null : (
          <div className="chat-content-lane">
            <HandoffRow
              environmentId={environmentId}
              endpoints={pendingHandoff}
              providers={providerStatuses}
              pending
            />
          </div>
        )}
        <ThreadNow
          key={routeThreadKey}
          attention={attentionNow}
          work={workNow}
          syncPhase={shownThreadSyncPhase}
          goal={goalNow}
        />
        {threadStatusLine}
        {hasQueuedTurns ? queuedRunsControl : null}
      </>
    );

  const pendingSidebarFileDrops = useSidebarPendingFileDropStore((state) => state.pending);
  const consumePendingFileDrop = useSidebarPendingFileDropStore(
    (state) => state.consumePendingFileDrop,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands pending sidebar file drops to the composer's imperative API once it mounts
  useEffect(() => {
    if (pendingSidebarFileDrops.length === 0) return;
    if (
      typeof composerDraftTarget === "string" ||
      !pendingSidebarFileDrops.some((drop) =>
        isSameSidebarThreadRef(composerDraftTarget, drop.threadRef),
      )
    ) {
      return;
    }
    if (!activeThread) return;
    if (!composerRef.current) {
      const raf = window.requestAnimationFrame(() => {
        if (!composerRef.current || typeof composerDraftTarget === "string") return;
        const files = consumePendingFileDrop(composerDraftTarget);
        if (files !== null) composerRef.current?.addDroppedFiles(files);
      });
      return () => window.cancelAnimationFrame(raf);
    }
    const files = consumePendingFileDrop(composerDraftTarget);
    if (files !== null) composerRef.current.addDroppedFiles(files);
  }, [
    activeThread,
    composerDraftTarget,
    composerRef,
    consumePendingFileDrop,
    pendingSidebarFileDrops,
  ]);

  const addDroppedFilesToComposer = useStableCallback(
    (files: Parameters<ChatComposerHandle["addDroppedFiles"]>[0]) =>
      composerRef.current?.addDroppedFiles(files),
  );
  const addDroppedFoldersToComposer = useStableCallback(
    (folders: Parameters<ChatComposerHandle["addDroppedFolders"]>[0]) =>
      composerRef.current?.addDroppedFolders(folders),
  );
  if (!activeThread) {
    return <NoActiveThreadState />;
  }

  const panelLayoutControls = (
    <WorkspaceTitlebarControls>
      <PanelLayoutControls
        threadPanelOpen={threadPanelOpen}
        threadPanelPresentation={threadPanelPresentation}
        threadPanelPopoverHandle={threadPanelPopoverHandle}
        threadPanelShortcutLabel={shortcutLabelForCommand(keybindings, "threadPanel.toggle")}
        onToggleThreadPanel={toggleThreadPanelStable}
      />
    </WorkspaceTitlebarControls>
  );
  const workspaceFileDropHandlers = makeWorkspaceFileDropHandlers({
    setDragActive: setIsWorkspaceFileDragActive,
    addFiles: addDroppedFilesToComposer,
    addFolders: addDroppedFoldersToComposer,
  });

  const content = (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden" data-chat-column>
          <header
            ref={threadPanelPopoverAnchorRef}
            data-chat-header
            className={cn(
              "relative bg-background [[data-panel-animations=true]_&]:motion-safe:transition-[padding-left] [[data-panel-animations=true]_&]:motion-safe:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:motion-safe:ease-out",
              isElectron
                ? cn(
                    "drag-region flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center px-3 sm:px-5",
                    reserveTitleBarControlInset && "wco:pr-(--workspace-native-controls-inset)",
                  )
                : "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)",
              COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
            )}
          >
            {panelLayoutControls}
            <ChatHeader
              activeThreadEnvironmentId={activeThread.environmentId}
              activeThreadId={activeThread.id}
              isServerThread={isServerThread}
              activeThreadTitle={activeThread.title}
              activeProject={activeProject ?? null}
              parentThreadLink={headerParentThreadLink}
              onOpenThread={onOpenRelatedThreadStable}
              rightPanelOpen={false}
              onNewThreadInProject={handleNewThreadInActiveProjectStable}
              {...(activeDraftLogicalProjectKey
                ? { onOpenProjectSettings: handleOpenDraftProjectSettingsStable }
                : {})}
              {...(threadFindEnabled ? { onFindInThread: openThreadFindStable } : {})}
            />
          </header>

        <div className="relative flex min-h-0 min-w-0 flex-1">
          <ThreadFindCanvas
            findOptions={{
              skills: timelineSkills,
              progressive: serverConfig?.threadFindProgressive === true,
              thread: activeThreadRef,
              enabled: threadFindEnabled,
            }}
            store={chatCanvasStore}
            threadRef={activeThreadRef}
            detailsCardTopInset={isThreadFindActive ? THREAD_FIND_BAR_RESERVED_HEIGHT : 0}
            composerOverlayElement={isDraftHeroState ? null : composerOverlayElement}
            data-chat-workspace-drop-target="true"
            onDragEnter={workspaceFileDropHandlers.onDragEnter}
            onDragOver={workspaceFileDropHandlers.onDragOver}
            onDragLeave={workspaceFileDropHandlers.onDragLeave}
            onDrop={workspaceFileDropHandlers.onDrop}
          >
            <ThreadFind onClose={focusComposerStable} />
            {isWorkspaceFileDragActive ? <WorkspaceFileDropOverlay /> : null}
            <ChatBannerLane
              environmentId={activeThread.environmentId}
              providerStatus={visibleProviderStatus}
              providerStatusBannerKey={providerStatusBannerKey}
              setDismissedProviderStatusBannerKey={setDismissedProviderStatusBannerKey}
              onOpenProviderSetup={openProviderSetupStable}
              threadId={activeThread.id}
              threadError={timelineThreadError}
              threadErrorClass={
                threadErrorIsServerRuntimeError ? (serverRuntime?.lastErrorClass ?? null) : null
              }
              threadErrorCode={
                threadErrorIsServerRuntimeError ? (serverRuntime?.lastErrorCode ?? null) : null
              }
              threadErrorBannerKey={threadErrorBannerKey}
              setThreadError={setThreadError}
              setThreadErrorBannerDismissTick={setThreadErrorBannerDismissTick}
            />
            <div
              {...conversationArea}
              className="relative flex min-h-0 flex-1 flex-col bg-background"
            >
              <WorkspaceMutationIdContext value={workspaceMutationId}>
                <ThreadTimeline
                  pendingApprovals={pendingApprovals}
                  heldApprovalRequestIds={heldApprovalRequestIds}
                  respondingRequestIds={respondingRequestIds}
                  onRespondToApproval={onRespondToApprovalStable}
                  canOperateThread={canOperateThread}
                  threadDetailRef={routeThreadDetailRef}
                  entriesInput={timelineEntriesInput}
                  draftEntries={isServerThread ? null : draftTimelineEntries}
                  activeThreadKey={activeThreadKey}
                  syncing={threadSyncPhase !== null}
                  detailLoading={threadDetailLoading}
                  citationRequest={citationRequest}
                  citationHistory={citationHistory}
                  onCiteAssistantText={citeAssistantTextStable}
                  isWorking={isWorking}
                  runlessWorkActive={runlessWorkStartedAt !== null}
                  isCompacting={isCompacting}
                  awaitingUser={
                    activePendingApproval !== null
                      ? "approval"
                      : activePendingUserInput !== null ||
                          // A secret request has no runtime request; the shell carries it.
                          activeThreadShell?.hasPendingUserInput === true
                        ? "input"
                        : null
                  }
                  awaitingRequestId={
                    activePendingApproval?.requestId ?? activePendingUserInput?.requestId ?? null
                  }
                  activeTurnStartedAt={activeWorkStartedAt}
                  footer={timelineFooter}
                  listRef={legendListRef}
                  runs={serverProjection?.runs ?? []}
                  latestRun={activeActivityRun}
                  announcedRun={announcedRun(activeActivityRun, serverProjection?.runs ?? [])}
                  detailBehindShell={isDetailBehindShell(
                    activeLatestRun,
                    activeThreadShell?.latestRun ?? null,
                  )}
                  runningRunId={activeRunningTurnId}
                  turnDiffSummaries={turnDiffSummaries}
                  activeThreadEnvironmentId={
                    displayedThreadRef?.environmentId ?? activeThread.environmentId
                  }
                  routeThreadKey={displayedTimelineKey}
                  displayThreadKey={displayedTimelineKey}
                  announceTurnStatus={!isProviderSubagent}
                  onOpenThread={onOpenRelatedThreadStable}
                  parentThreadLink={parentThreadLink}
                  workflowOpening={workflowOpening}
                  supportsConversationRollback={supportsConversationRollback}
                  threadStartCheckpointReady={threadStartCheckpointReady}
                  availableRevertTurnCounts={availableRevertTurnCounts}
                  onRevertToTurnCount={onRevertTimelineTurnStable}
                  isRevertingCheckpoint={isRevertingCheckpoint}
                  onImageExpand={onExpandTimelineImageStable}
                  onFileOpen={openFileAttachmentStable}
                  onFileDownload={downloadFileAttachmentStable}
                  markdownCwd={gitCwd ?? undefined}
                  resolvedTheme={resolvedTheme}
                  timestampFormat={timestampFormat}
                  workspaceRoot={activeWorkspaceRoot}
                  skills={timelineSkills}
                  anchorMessageId={timelineAnchorMessageId}
                  onAnchorReady={onTimelineAnchorReadyStable}
                  onAnchorSizeChanged={onTimelineAnchorSizeChangedStable}
                  contentInsetEndAdjustment={composerTimelineInset}
                  liveFollowEnabled={timelineLiveFollowEnabled}
                  onIsAtEndChange={onIsAtEndChangeStable}
                  onViewportAttach={attachTimelineViewport}
                  onFooterGrow={onTimelineFooterGrowStable}
                  hideEmptyPlaceholder={isDraftHeroState || threadDetailLoading}
                  emptyPlaceholderInset={composerReservedHeight}
                  topFadeEnabled={!hasTimelineTopBanner}
                  {...(threadHistoryControls === undefined
                    ? {}
                    : { historyControls: threadHistoryControls })}
                />
              </WorkspaceMutationIdContext>

              {showScrollToBottom && !isThreadFindActive && (
                <ScrollToEndButton
                  bottom={scrollToEndClearance + 4}
                  summary={scrollToEndSummary}
                  onScrollToEnd={() => scrollToEnd(true)}
                />
              )}
            </div>

            <div
              {...composerArea}
              ref={(overlay: HTMLDivElement | null) => {
                setComposerOverlayElement(overlay);
                attachFollowComposerOverlay(overlay);
              }}
              inert={isRevertingCheckpoint}
              data-chat-composer-overlay="true"
              className={
                isDraftHeroState
                  ? "pointer-events-none absolute inset-0 z-20 flex items-center [@media(max-height:34rem)]:items-end"
                  : "pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2"
              }
            >
              <div ref={draftHeroTransitionGroupRef} className="chat-composer-lane w-full">
                <div
                  data-chat-composer-stack="true"
                  className="group/composer-stack pointer-events-auto relative z-10 mx-auto w-full max-w-(--chat-content-max-width)"
                >
                  {isDraftHeroState ? (
                    <div className="absolute inset-x-0 bottom-full">
                      <div
                        className="pb-4 group-has-data-[composer-shoulder-tab]/composer-stack:pb-0"
                        style={
                          forceExpandedMobileComposer
                            ? { viewTransitionName: MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME }
                            : undefined
                        }
                      >
                        <DraftHeroHeadline
                          draftId={draftId}
                          activeProjectRef={activeProjectRef}
                          activeProjectTitle={activeProject?.title ?? null}
                        />
                      </div>
                    </div>
                  ) : null}
                  <div
                    ref={draftHeroComposerAnchorRef}
                    className="relative z-10"
                    style={
                      forceExpandedMobileComposer
                        ? { viewTransitionName: MOBILE_COMPOSER_VIEW_TRANSITION_NAME }
                        : undefined
                    }
                  >
                    <ChildThreadApprovals threadRef={activeThreadRef} />
                    <div className="relative">
                      <ComposerSurface.Shell contextRow={showComposerContextStrip}>
                        <ComposerSurface.Host
                          inert={queuedRunEdit.isSaving}
                          aria-busy={queuedRunEdit.isSaving}
                        >
                          <div className="relative z-10">
                            {showProviderSubagentBar ? (
                              <ProviderSubagentBar
                                provider={selectedProviderEntry ?? null}
                                showInstanceBadge={
                                  selectedProviderEntry !== undefined &&
                                  shouldShowInstanceBadge(
                                    selectedProviderEntry,
                                    providerInstanceEntries,
                                  )
                                }
                                modelLabel={providerSubagentModelLabel}
                                effortLabel={providerSubagentEffortLabel}
                                status={providerSubagentStatus}
                                onOpenParent={parentThreadLink?.open ?? null}
                              />
                            ) : null}
                            {!composerMounted ? null : (
                              <ChatComposer
                                canOperateThread={canOperateThread}
                                reportedModelSelection={reportedModelSelection}
                                composerRef={composerRef}
                                composerDraftTarget={composerDraftTarget}
                                environmentId={environmentId}
                                routeKind={routeKind}
                                routeThreadRef={routeThreadRef}
                                draftId={draftId}
                                activeThreadId={activeThreadId}
                                activeThread={activeThread}
                                activeThreadRuns={serverProjection?.runs ?? EMPTY_RUNS}
                                promptHistoryEntries={timelineEntries}
                                forceExpandedOnMobile={
                                  forceExpandedMobileComposer && isDraftHeroState
                                }
                                projectSelectionRequired={
                                  isLocalDraftThread && activeProject === null
                                }
                                phase={phase}
                                isCompacting={isCompacting}
                                canInterrupt={canInterruptRunningThread}
                                isSendBusy={
                                  (isSendBusy && !sendQueuesBehindSetup) ||
                                  (setupQueueSendThreadKey !== null &&
                                    setupQueueSendThreadKey === activeThreadKey) ||
                                  queuedRunEdit.isSaving ||
                                  isResuming
                                }
                                canResume={resumableRunId !== null || hasHeldQueuedRuns}
                                isRevertingCheckpoint={isRevertingCheckpoint}
                                sendDisabledReason={
                                  !canOperateThread
                                    ? "This connection cannot change threads."
                                    : isRevertingCheckpoint
                                      ? "Rewinding conversation"
                                      : threadDetailLoading
                                        ? "Messages loading"
                                        : null
                                }
                                bannerItems={
                                  isDraftHeroState || composerBannerItems.length === 0
                                    ? EMPTY_COMPOSER_BANNER_ITEMS
                                    : composerBannerItems
                                }
                                resumeCompactionTokens={resumeCompactionTokens}
                                keepFullHistory={keepFullHistory}
                                onToggleKeepFullHistory={toggleKeepFullHistoryStable}
                                onFreshSession={
                                  freshSessionCommandAvailable ? armFreshSessionStable : undefined
                                }
                                activePendingApproval={activePendingApproval}
                                pendingApprovals={pendingApprovals}
                                onHeldRequestIdsChange={onHeldRequestIdsChange}
                                pendingUserInputs={pendingUserInputs}
                                activePendingProgress={activePendingProgress}
                                activePendingResolvedAnswers={activePendingResolvedAnswers}
                                activePendingIsResponding={activePendingIsResponding}
                                activePendingDraftAnswers={activePendingDraftAnswers}
                                activePendingQuestionIndex={activePendingQuestionIndex}
                                respondingRequestIds={respondingRequestIds}
                                lockedProvider={modelPickerLockedProvider}
                                providerStatuses={providerStatuses as ServerProvider[]}
                                providerCatalogKnown={serverConfig !== null}
                                activeProjectDefaultModelSelection={
                                  activeProjectDefaultModelSelection
                                }
                                activeThreadModelSelection={activeThread?.modelSelection}
                                activeProjectId={activeProject?.id ?? null}
                                projectName={activeProject?.title}
                                compactThreadUnavailable={compactThreadUnavailable}
                                compactDisabled={compactDisabled}
                                resolvedTheme={resolvedTheme}
                                settings={settings}
                                keybindings={keybindings}
                                gitCwd={gitCwd}
                                pullRequestProjectId={
                                  supportsPullRequests ? (activeProject?.id ?? null) : null
                                }
                                pullRequestRepository={
                                  supportsPullRequests ? activeProjectRepository : null
                                }
                                threadPullRequests={
                                  (activeThreadShell ?? activeThread)?.pullRequests
                                }
                                onComposerOverlayHeightChange={publishComposerOverlayHeightStable}
                                promptRef={promptRef}
                                composerImagesRef={composerImagesRef}
                                composerFilesRef={composerFilesRef}
                                onPageScrollKeyDown={onComposerPageScrollKeyDownStable}
                                onPageScrollKeyUp={onComposerPageScrollKeyUpStable}
                                onPageScrollRelease={onComposerPageScrollReleaseStable}
                                onCompactContext={onComposerCompactContextStable}
                                onSend={onComposerSendStable}
                                onResume={onComposerResumeStable}
                                onInterrupt={onInterruptStable}
                                onSelectActivePendingUserInputOption={
                                  onSelectActivePendingUserInputOptionStable
                                }
                                onAdvanceActivePendingUserInput={
                                  onAdvanceActivePendingUserInputStable
                                }
                                onDismissActivePendingUserInput={onDismissUserInputStable}
                                onPreviousActivePendingUserInputQuestion={
                                  onPreviousActivePendingUserInputQuestionStable
                                }
                                onChangeActivePendingUserInputCustomAnswer={
                                  onChangeActivePendingUserInputCustomAnswer
                                }
                                onProviderModelSelect={onProviderModelSelectStable}
                                onOpenProviderSetup={openProviderSetupStable}
                                getModelDisabledReason={getModelDisabledReason}
                                focusComposer={focusComposerStable}
                                scheduleComposerFocus={scheduleComposerFocusStable}
                                setThreadError={setThreadError}
                                onExpandImage={onExpandTimelineImageStable}
                                onFileOpen={openFileAttachmentStable}
                                editingQueuedAttachments={queuedRunEdit.editingAttachments}
                                onRemoveEditingQueuedAttachment={
                                  queuedRunEdit.removeEditingAttachment
                                }
                              />
                            )}
                          </div>
                        </ComposerSurface.Host>
                        <div className="min-h-0">
                          <div className="relative z-0">
                            {showComposerContextStrip && (
                              <div className="pointer-events-auto">
                                <BranchToolbar
                                  ref={branchToolbarRef}
                                  environmentId={activeThread.environmentId}
                                  threadId={activeThread.id}
                                  projectId={activeThread.projectId}
                                  showGitControls={isGitRepo}
                                  {...(routeKind === "draft" && draftId ? { draftId } : {})}
                                  {...(canOverrideServerThreadBranch
                                    ? {
                                        activeThreadBranchOverride: activeThreadBranch,
                                        onActiveThreadBranchOverrideChange:
                                          setPendingServerThreadBranch,
                                      }
                                    : {})}
                                  onComposerFocusRequest={scheduleComposerFocusStable}
                                  {...(canCheckoutPullRequestIntoThread
                                    ? { onCheckoutPullRequestRequest: openPullRequestDialogStable }
                                    : {})}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </ComposerSurface.Shell>
                      {isDraftHeroState && composerBannerItems.length > 0 ? (
                        // Out of flow, like the headline, so a notice never moves the centered composer.
                        // Short windows pin the composer to the bottom, where an out-of-flow notice
                        // would fall off-screen, so there it takes space and lifts the composer.
                        <div className="absolute inset-x-0 top-full flex flex-col gap-1 pt-4 [@media(max-height:34rem)]:static">
                          <ComposerBannerStack items={composerBannerItems} detached />
                        </div>
                      ) : null}
                    </div>
                    <div
                      aria-hidden
                      className="h-[calc(env(safe-area-inset-bottom)+1rem)] sm:h-[calc(env(safe-area-inset-bottom)+1.25rem)]"
                    />
                  </div>
                </div>
              </div>
            </div>

                        <>
                <BranchRestoreConfirmHost
                  threadKey={activeThreadKey}
                  threadBranch={localCheckoutBranchMismatch?.threadBranch ?? ""}
                  canWriteSourceControl={canWriteSourceControl}
                  onConfirm={handleSwitchCheckoutToThreadStable}
                />

                <ThreadDetailsPanel
                  anchor={threadPanelPopoverAnchorRef}
                  handle={threadPanelPopoverHandle}
                  environmentId={activeThread.environmentId}
                  threadId={activeThread.id}
                  projectId={activeThread.projectId}
                  {...(draftId ? { draftId } : {})}
                  activeProjectName={activeProject?.title}
                  gitCwd={gitCwd}
                  isGitRepo={isGitRepo}
                  {...(canOverrideServerThreadBranch
                    ? {
                        activeThreadBranchOverride: activeThreadBranch,
                        onActiveThreadBranchOverrideChange: setPendingServerThreadBranch,
                      }
                    : {})}
                  {...(canCheckoutPullRequestIntoThread
                    ? { onCheckoutPullRequestRequest: openPullRequestDialogStable }
                    : {})}
                  onComposerFocusRequest={scheduleComposerFocusStable}
                  usage={{
                    providerInstanceId: activeProviderInstanceId,
                    providers: providerStatuses,
                    sources: serverConfig?.usageLimitSources ?? EMPTY_USAGE_LIMIT_SOURCES,
                    contextWindow: activeContextWindow,
                  }}
                />

                <PullRequestThreadDialogHost
                  threadKey={activeThreadKey}
                  environmentId={activeThread.environmentId}
                  threadId={activeThread.id}
                  cwd={activeProject?.workspaceRoot ?? null}
                  onPrepared={handlePreparedPullRequestThreadStable}
                />
              </>
          </ThreadFindCanvas>
        </div>
      </div>

      <RevertConfirmHost threadKey={routeThreadKey} onConfirm={onConfirmRevertStable} />
      <LinkPullRequestDialogHost />
      <ThreadVisitWatermark threadRef={routeThreadRef} />
      <ExpandedImageDialogHost threadKey={routeThreadKey} />
    </div>
  );
  return (
    <FileMetadataThreadProvider
      threadRef={activeThreadRef}
      cwd={activeWorkspaceRoot}
      checkpoints={serverProjection?.checkpoints}
    >
      {content}
    </FileMetadataThreadProvider>
  );
}
