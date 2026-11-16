import { isClearComposerCommand } from "~/shared/composerTrigger";
import { armFreshSession, disarmFreshSession, readFreshSessionArm } from "./freshSessionArms";
import {
  shouldDockDraftHeroForSubmission,
  deriveComposerSendState,
  boundAttachmentIds,
  formatOutgoingPrompt,
  optimisticMessageAttachments,
  planComposerTurn,
  sendTitleFallbackLabels,
  snapshotComposerSend,
  withMessageContext,
  makeThreadErrorSetter,
} from "../ChatView.logic";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_MODEL,
  type EnvironmentId,
  type ModelSelection,
  type ThreadId,
  ProviderInteractionMode,
  RuntimeMode,
} from "~/contracts";
import { deriveThreadTitleSeed } from "~/rt/operations/index";
import { wasBootstrapThreadDeleted } from "~/rt/errors/index";
import { declinePendingApprovals, sendApprovalFeedback } from "~/rt/state/threadRequests";
import { scopedThreadKey, scopeProjectRef, scopeThreadRef } from "~/rt/environment/index";
import { createModelSelection } from "~/shared/model";
import { type SetStateAction, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "~/rt/state/runtime";
import { type ComposerSubmissionIntent, collapseExpandedComposerCursor } from "../../composer-logic";
import { type ChatMessage, DEFAULT_INTERACTION_MODE } from "../../types";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { newMessageId, newThreadId } from "~/lib/utils";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  beginBackgroundDraftSubmissionByRef,
  clearBackgroundDraftSubmissionByRef,
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  restoreFailedDraftThread,
  composerDraftHasUserContent,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  useComposerDraftStore,
  DraftId,
} from "../../composerDraftStore";
import { buildMessageContext } from "../../lib/composerContextRecords";
import { threadEnvironment } from "../../state/threads";
import { runMobileComposerTransition } from "./draftHeroTransition";
import { useClientSettingsHydrated } from "../../hooks/useSettings";
import { environmentPresentations } from "../../state/presentation";
import { approvalRedirectNotice } from "./composerSend.logic";
import { type ComposerDispatchMode } from "~/rt/state/composerDispatch";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readEnvironmentScope } from "../../state/session";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "~/shared/composerContextReferences";
import { draftSendState, prepareTurnAttachments, restoreComposerDraft } from "./chatViewSend";
import type { EnvironmentProject, EnvironmentThreadShell } from "~/rt/state/models";
import type { Dispatch } from "react";
import type { ComposerThreadTarget } from "../../composerDraftStore";
import type { ProviderInstanceEntry } from "../../providerInstances";
import type { SessionPhase } from "../../types";
import type { DraftSessionState } from "../../composerDraftStore";
import type { ComposerHandleRef } from "../../composerHandleContext";
import type { useLocalDispatchState } from "./useLocalDispatchState";
import type { usePendingThreadRequests } from "./usePendingThreadRequests";
import type { useQueuedRunEdit } from "./useQueuedRunEdit";
import type { useTimelineFollow } from "./useTimelineFollow";
import type { useUsageLimitsPanel } from "./useUsageLimitsPanel";

function readEnvironmentPresentation(environmentId: EnvironmentId) {
  return appAtomRegistry.get(environmentPresentations.presentationsAtom).get(environmentId);
}

type PendingThreadRequests = ReturnType<typeof usePendingThreadRequests>;
type LocalDispatchState = ReturnType<typeof useLocalDispatchState>;
type UsageLimitsPanel = ReturnType<typeof useUsageLimitsPanel>;
type TimelineFollow = ReturnType<typeof useTimelineFollow>;

interface ComposerSendInput {
  readonly environmentId: EnvironmentId;
  readonly routeThreadKey: string;
  readonly currentRouteThreadKeyRef: { readonly current: string | null };
  readonly draftId: DraftId | null;
  readonly draftThread: DraftSessionState | null;
  readonly activeThread: EnvironmentThreadShell | undefined;
  readonly activeThreadKey: string | null;
  readonly activeThreadBranch: string | null;
  readonly activeProject: EnvironmentProject | null;
  readonly activeProjectDefaultModelSelection: ModelSelection | null;
  readonly isServerThread: boolean;
  readonly isLocalDraftThread: boolean;
  readonly phase: SessionPhase;
  readonly runtimeMode: RuntimeMode;
  readonly localCheckoutBranchMismatch: {
    readonly threadBranch: string;
    readonly currentBranch: string;
  } | null;
  readonly providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly composerRef: ComposerHandleRef;
  readonly composerDraftTarget: ComposerThreadTarget;
  readonly promptRef: { current: string };
  readonly composerImagesRef: { current: ComposerImageAttachment[] };
  readonly composerFilesRef: { current: ComposerFileAttachment[] };
  readonly queuedRunEdit: ReturnType<typeof useQueuedRunEdit>;
  readonly isRevertingCheckpoint: boolean;
  readonly threadDetailLoading: boolean;
  readonly isSendBusy: boolean;
  readonly sendQueuesBehindSetup: boolean;
  readonly isDraftHeroState: boolean;
  readonly panelAnimationsActive: boolean;
  readonly panelAnimationDurationMs: number;
  readonly keepFullHistory: boolean;
  /** `/clear` can arm a fresh session on this thread. */
  readonly freshSessionAvailable: boolean;
  readonly resumeCompactionTokens: number | null;
  readonly clearUsageLimitsFor: UsageLimitsPanel["clearFor"];
  readonly pendingApprovals: PendingThreadRequests["pendingApprovals"];
  readonly respondingRequestIds: PendingThreadRequests["respondingRequestIds"];
  readonly activePendingProgress: PendingThreadRequests["activePendingProgress"];
  readonly onAdvanceActivePendingUserInput: PendingThreadRequests["onAdvanceActivePendingUserInput"];
  readonly onRespondToApproval: PendingThreadRequests["onRespondToApproval"];
  readonly beginLocalDispatch: LocalDispatchState["beginLocalDispatch"];
  readonly resetLocalDispatch: LocalDispatchState["resetLocalDispatch"];
  readonly captureDraftHeroComposerRect: () => void;
  readonly setDockedDraftHeroThreadKey: Dispatch<SetStateAction<string | null>>;
  readonly setSetupQueueSendThreadKey: Dispatch<SetStateAction<string | null>>;
  readonly setOptimisticUserMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  /** Takes ownership of, and later releases, an optimistic message's blob previews. */
  readonly optimisticBlobPreviews: {
    readonly track: (message: ChatMessage) => void;
    readonly release: (message: ChatMessage) => void;
  };
  readonly setThreadError: ReturnType<typeof makeThreadErrorSetter>;
  readonly setKeepFullHistory: (threadKey: string, keep: boolean) => void;
  readonly anchorNewTurn: TimelineFollow["anchorNewTurn"];
  readonly handleNewThreadInActiveProject: () => void;
  readonly persistThreadSettingsForNextTurn: (input: {
    threadId: ThreadId;
    createdAt: string;
    branch?: string;
    runtimeMode: RuntimeMode;
    interactionMode: ProviderInteractionMode;
  }) => Promise<AtomCommandResult<void, unknown>>;
}

/**
 * Everything the composer's send button can start: a turn on this thread or a new one,
 * a queued or steering message, a plan follow-up or implementation thread, and resuming
 * an interrupted run. Each path restores the draft when it fails.
 */
export function useComposerSend(input: ComposerSendInput) {
  const {
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
    freshSessionAvailable,
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
    optimisticBlobPreviews,
    setThreadError,
    setKeepFullHistory,
    anchorNewTurn,
    handleNewThreadInActiveProject,
    persistThreadSettingsForNextTurn,
  } = input;
  const handleNewThread = useNewThreadHandler();
  const navigate = useNavigate();
  const clientSettingsHydrated = useClientSettingsHydrated();
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const { sendInFlight: sendInFlightRef } = draftSendState(routeThreadKey);
  const composerSendGenerationRef = useRef(0);
  // A send awaits uploads before it declines, so it reads the approvals pending by then.
  const pendingApprovalsRef = useRef(pendingApprovals);
  const respondingRequestIdsRef = useRef(respondingRequestIds);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors approvals into refs that an async send reads after awaiting uploads
  useLayoutEffect(() => {
    pendingApprovalsRef.current = pendingApprovals;
    respondingRequestIdsRef.current = respondingRequestIds;
  }, [pendingApprovals, respondingRequestIds]);

  const onSend = async (
    e?: { preventDefault: () => void },
    dispatchMode: ComposerDispatchMode = "auto",
    submissionIntent: ComposerSubmissionIntent = "foreground",
  ) => {
    e?.preventDefault();
    // What the user pressed send on; uploads below can take a while, and a redirect must not
    // decline approvals for a draft that changed meanwhile.
    const promptAtSend = promptRef.current;
    if (
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope) ||
      !activeThread ||
      (isSendBusy && !sendQueuesBehindSetup) ||
      isRevertingCheckpoint ||
      !clientSettingsHydrated ||
      threadDetailLoading ||
      sendInFlightRef.current
    ) {
      return;
    }
    const sendCtx = composerRef.current?.getSendContext();
    const answeringQuestion =
      Boolean(activePendingProgress) && sendCtx?.answeringPendingUserInput !== false;
    if (answeringQuestion) {
      onAdvanceActivePendingUserInput();
      return;
    }
    if (!sendCtx?.providerAvailable) {
      return;
    }
    const approvalFeedbackTarget = pendingApprovalsRef.current.find(
      (approval) =>
        approval.supportsFeedback && approval.requestId === sendCtx.shownPendingApprovalIds[0],
    );
    const {
      images: composerImages,
      files: composerFiles,
      reviewComments: composerReviewComments,
      threadContexts: composerThreadContexts,
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
    } = sendCtx;
    const promptForSend = promptRef.current;
    if (queuedRunEdit.isEditing) {
      // Edit mode repurposes the composer: sending saves the queued message
      // in place instead of dispatching a new turn.
      await queuedRunEdit.saveEdit(
        {
          prompt: promptForSend,
          images: composerImages,
          files: composerFiles,
          reviewComments: composerReviewComments,
          threadContexts: composerThreadContexts,
        },
        setThreadError,
      );
      return;
    }
    const { trimmedPrompt: trimmed, hasSendableContent } = deriveComposerSendState({
      prompt: promptForSend,
      imageCount: composerImages.length + composerFiles.length,
      elementContextCount: composerReviewComments.length + composerThreadContexts.length,
    });
    const composerHoldsOnlyText =
      composerImages.length === 0 &&
      composerFiles.length === 0 &&
      composerReviewComments.length === 0 &&
      composerThreadContexts.length === 0;
    if (freshSessionAvailable && composerHoldsOnlyText && isClearComposerCommand(trimmed)) {
      armFreshSession(routeThreadKey);
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
      return;
    }
    // Read once: an arm made while this send is in flight belongs to the next message.
    const freshArm = freshSessionAvailable ? readFreshSessionArm(routeThreadKey) : undefined;
    if (!hasSendableContent) {
      return;
    }
    if (!activeProject) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Choose a project first",
          description: "This draft no longer points to an available project.",
        }),
      );
      return;
    }
    const threadIdForSend = activeThread.id;
    const sendSnapshot = snapshotComposerSend({
      prompt: promptForSend,
      images: composerImages,
      files: composerFiles,
      reviewComments: composerReviewComments,
      threadContexts: composerThreadContexts,
    });
    const {
      files: composerFilesSnapshot,
      attachments: composerAttachmentsSnapshot,
      reviewComments: composerReviewCommentsSnapshot,
      threadContexts: composerThreadContextsSnapshot,
      messageText: messageTextForSend,
    } = sendSnapshot;
    const {
      compactBeforeSend,
      turnDispatchMode,
      shouldQueueBehindActiveRun,
    } = planComposerTurn({
      messageText: messageTextForSend,
      sendQueuesBehindSetup,
      resumeCompactionTokens,
      keepFullHistory,
      phase,
      dispatchMode,
      freshContext: freshArm !== undefined,
    });
    // Records bind attachments by their local id, on the optimistic row and on the wire.
    const buildOutgoingMessageContext = (attachmentIds: ReadonlyArray<string>) =>
      buildMessageContext({
        reviewComments: composerReviewCommentsSnapshot,
        threadContexts: composerThreadContextsSnapshot,
        attachments: composerAttachmentsSnapshot.map((attachment, index) => ({
          attachment,
          attachmentId: attachmentIds[index] ?? attachment.id,
        })),
      });
    const outgoingMessageContext = buildOutgoingMessageContext(
      composerAttachmentsSnapshot.map((attachment) => attachment.id),
    );
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    const outgoingMessageText = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: messageTextForSend || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
    });
    if (composerRef.current?.validateProviderInput(outgoingMessageText) === false) {
      return;
    }

    if (composerFilesSnapshot.length > 0) {
      setThreadError(threadIdForSend, "Unharnessed sends images only: remove the other files to send.");
      return;
    }
    sendInFlightRef.current = true;
    const sendGeneration = ++composerSendGenerationRef.current;

    if (
      shouldDockDraftHeroForSubmission({ isDraftHeroState, activeThreadKey, submissionIntent }) &&
      activeThreadKey
    ) {
      let resolveDockStarted: (() => void) | undefined;
      const dockStarted = new Promise<void>((resolve) => {
        resolveDockStarted = resolve;
      });
      const dockTransition = runMobileComposerTransition(
        () => {
          flushSync(() => {
            captureDraftHeroComposerRect();
            setDockedDraftHeroThreadKey(activeThreadKey);
          });
          resolveDockStarted?.();
        },
        {
          active: panelAnimationsActive,
          durationMs: panelAnimationDurationMs,
        },
      );
      void dockTransition.catch(() => resolveDockStarted?.());
      await dockStarted;
    }

    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      sendInFlightRef.current = false;
      setThreadError(threadIdForSend, "This connection cannot change threads.");
      setDockedDraftHeroThreadKey((currentThreadKey) =>
        currentThreadKey === activeThreadKey ? null : currentThreadKey,
      );
      return;
    }
    // A message sent while approvals are pending redirects the agent. They are declined only
    // here, after everything above has accepted the send, so local commands and rejected
    // drafts leave them alone. After navigating away during an upload, the shown approvals
    // are another thread's, so this send leaves them alone too.
    const approvalsToDecline =
      currentRouteThreadKeyRef.current === routeThreadKey
        ? pendingApprovalsRef.current.filter((approval) =>
            sendCtx?.shownPendingApprovalIds.includes(approval.requestId),
          )
        : [];
    if (approvalsToDecline.length > 0 || approvalFeedbackTarget !== undefined) {
      // A draft edited since send, or a paste still landing in it, is no longer the message
      // the user sent.
      const attachmentIdsAtSend = composerAttachmentsSnapshot.map((attachment) => attachment.id);
      const sameIds = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
        left.length === right.length && left.every((id, index) => id === right[index]);
      const draftChangedSinceSend = () => {
        if (composerRef.current?.hasPendingAttachments() === true) return true;
        const sendContext = composerRef.current?.getSendContext();
        const attachmentIds = sendContext
          ? [...sendContext.images, ...sendContext.files].map((attachment) => attachment.id)
          : attachmentIdsAtSend;
        const promptUnchanged =
          promptRef.current === promptAtSend || promptRef.current === promptForSend;
        const attachmentsUnchanged = sameIds(attachmentIds, attachmentIdsAtSend);
        return !promptUnchanged || !attachmentsUnchanged;
      };
      const draftBeforeDecline = useComposerDraftStore
        .getState()
        .getComposerDraft(composerDraftTarget);
      const changedBeforeDecline = draftChangedSinceSend();
      const pendingIdsBeforeDecline = pendingApprovalsRef.current.map(
        (approval) => approval.requestId,
      );
      const approvalResponding = approvalsToDecline.some((approval) =>
        respondingRequestIdsRef.current.includes(approval.requestId),
      );
      if (approvalFeedbackTarget !== undefined) {
        if (composerAttachmentsSnapshot.length > 0 || outgoingMessageContext !== undefined) {
          setThreadError(
            threadIdForSend,
            "Send approval feedback without attachments or added context.",
          );
          sendInFlightRef.current = false;
          return;
        }
        if (
          changedBeforeDecline ||
          approvalResponding ||
          currentRouteThreadKeyRef.current !== routeThreadKey
        ) {
          sendInFlightRef.current = false;
          return;
        }
        const sent = await sendApprovalFeedback(
          approvalFeedbackTarget,
          messageTextForSend,
          onRespondToApprovalStable,
        ).catch(() => false);
        sendInFlightRef.current = false;
        if (
          sent &&
          !draftChangedSinceSend() &&
          currentRouteThreadKeyRef.current === routeThreadKey &&
          useComposerDraftStore.getState().getComposerDraft(composerDraftTarget) ===
            draftBeforeDecline
        ) {
          promptRef.current = "";
          clearComposerDraftContent(composerDraftTarget);
          composerRef.current?.resetCursorState();
        }
        return;
      }
      const declined =
        !changedBeforeDecline &&
        !approvalResponding &&
        (await declinePendingApprovals(approvalsToDecline, onRespondToApprovalStable).catch(
          () => false,
        ));
      const draftChanged =
        changedBeforeDecline ||
        draftChangedSinceSend() ||
        useComposerDraftStore.getState().getComposerDraft(composerDraftTarget) !==
          draftBeforeDecline;
      // An approval that arrived during the decline would block the redirect; keep the draft so
      // the next send declines it too.
      const approvalArrived = pendingApprovalsRef.current.some(
        (approval) => !pendingIdsBeforeDecline.includes(approval.requestId),
      );
      if (
        !declined ||
        draftChanged ||
        approvalArrived ||
        currentRouteThreadKeyRef.current !== routeThreadKey
      ) {
        sendInFlightRef.current = false;
        setDockedDraftHeroThreadKey((currentThreadKey) =>
          currentThreadKey === activeThreadKey ? null : currentThreadKey,
        );
        const notice = approvalRedirectNotice({
          draftChanged,
          declined,
          approvalResponding,
          approvalArrived,
        });
        if (notice !== null) {
          toastManager.add({
            type: "info",
            title: notice,
            description: "Send again when it's ready.",
          });
        }
        return;
      }
    }
    if (sendQueuesBehindSetup) {
      setSetupQueueSendThreadKey(activeThreadKey);
    } else {
      beginLocalDispatch({
        submissionIntent:
          submissionIntent === "background" && !isLocalDraftThread
            ? "foreground"
            : submissionIntent,
      });
    }

    const turnAttachmentsPromise = prepareTurnAttachments({
      attachments: composerAttachmentsSnapshot,
    });
    const optimisticAttachments = optimisticMessageAttachments(composerAttachmentsSnapshot);
    if (!shouldQueueBehindActiveRun) {
      anchorNewTurn(
        scopedThreadKey(scopeThreadRef(activeThread.environmentId, threadIdForSend)),
        messageIdForSend,
      );
    }
    const optimisticMessage: ChatMessage = {
      id: messageIdForSend,
      role: "user",
      text: outgoingMessageText,
      ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
      ...(outgoingMessageContext !== undefined ? { context: outgoingMessageContext } : {}),
      runId: null,
      createdAt: messageCreatedAt,
      updatedAt: messageCreatedAt,
      streaming: false,
      ...(shouldQueueBehindActiveRun
        ? { inputIntent: "queued_turn" as const }
        : phase === "running" && dispatchMode === "steer"
          ? { inputIntent: "steer" as const }
          : {}),
    };
    // After leaving the thread during an upload, its previews were already released and the
    // message is never shown, so tracking them would keep them alive past the thread.
    if (currentRouteThreadKeyRef.current === routeThreadKey) {
      optimisticBlobPreviews.track(optimisticMessage);
    } else {
      optimisticBlobPreviews.release(optimisticMessage);
    }
    setOptimisticUserMessages((existing) => [...existing, optimisticMessage]);
    setThreadError(threadIdForSend, null);
    const sentDraftThreadRef = isLocalDraftThread
      ? scopeThreadRef(environmentId, threadIdForSend)
      : null;
    // Keep new-thread flows from reusing this draft while attachments settle.
    if (sentDraftThreadRef) markPromotedDraftThreadByRef(sentDraftThreadRef);
    promptRef.current = "";
    clearComposerDraftContent(composerDraftTarget);
    composerRef.current?.resetCursorState();

    const title = deriveThreadTitleSeed({
      text: messageTextForSend,
      attachments: composerAttachmentsSnapshot,
      fallbackLabels: sendTitleFallbackLabels(sendSnapshot),
    });
    const threadCreateModelSelection = createModelSelection(
      ctxSelectedModelSelection.instanceId,
      ctxSelectedModel || activeProjectDefaultModelSelection?.model || DEFAULT_MODEL,
      ctxSelectedModelSelection.options,
    );

    let failure: AtomCommandResult<unknown, unknown> | null = null;

    if (failure === null && isServerThread) {
      const settingsResult = await persistThreadSettingsForNextTurn({
        threadId: threadIdForSend,
        createdAt: messageCreatedAt,
        ...(localCheckoutBranchMismatch
          ? { branch: localCheckoutBranchMismatch.currentBranch }
          : {}),
        runtimeMode,
        interactionMode: DEFAULT_INTERACTION_MODE,
      });
      if (settingsResult._tag === "Failure") {
        failure = settingsResult;
      }
    }

    const turnAttachmentsResult = await settlePromise(() => turnAttachmentsPromise);
    if (failure === null && turnAttachmentsResult._tag === "Failure") {
      failure = turnAttachmentsResult;
    }

    if (failure === null && compactBeforeSend) {
      const compactResult = await startThreadTurn({
        environmentId,
        input: {
          threadId: threadIdForSend,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: "/compact",
            attachments: [],
            idleCompaction: "onReturn",
          },
          modelSelection: ctxSelectedModelSelection,
          runtimeMode,
          interactionMode: DEFAULT_INTERACTION_MODE,
        },
      });
      if (compactResult._tag === "Failure") {
        failure = compactResult;
      }
    }

    let backgroundDraftOpened = false;
    let turnStartSucceeded = false;
    if (failure === null && turnAttachmentsResult._tag === "Success") {
      const bootstrap = isLocalDraftThread
        ? {
            createThread: {
              projectId: activeProject.id,
              title,
              modelSelection: threadCreateModelSelection,
              runtimeMode,
              interactionMode: DEFAULT_INTERACTION_MODE,
              branch: activeThreadBranch,
              worktreePath: activeThread.worktreePath,
              createdAt: activeThread.createdAt,
            },
          }
        : undefined;
      const backgroundThreadRef =
        submissionIntent === "background" && isLocalDraftThread
          ? scopeThreadRef(environmentId, threadIdForSend)
          : null;
      if (backgroundThreadRef) beginBackgroundDraftSubmissionByRef(backgroundThreadRef);
      const startPromise = startThreadTurn({
        environmentId,
        input: {
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            attachments: turnAttachmentsResult.value,
            ...withMessageContext({
              text: outgoingMessageText,
              context: buildOutgoingMessageContext(
                boundAttachmentIds(turnAttachmentsResult.value, composerAttachmentsSnapshot),
              ),
            }),
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: title,
          runtimeMode,
          interactionMode: DEFAULT_INTERACTION_MODE,
          dispatchMode: turnDispatchMode,
          ...(freshArm === undefined ? {} : { freshContext: true }),
          ...(bootstrap ? { bootstrap } : {}),
          createdAt: messageCreatedAt,
        },
      });
      if (backgroundThreadRef) {
        try {
          backgroundDraftOpened = Boolean(
            await handleNewThread(
              scopeProjectRef(activeProject.environmentId, activeProject.id),
              { branch: activeThreadBranch, worktreePath: null },
            ),
          );
        } catch (error) {
          clearBackgroundDraftSubmissionByRef(backgroundThreadRef);
          toastManager.add(
            stackedThreadToast({
              type: "warning",
              title: "Could not open a fresh composer",
              description: error instanceof Error ? error.message : undefined,
            }),
          );
        }
      }
      const startResult = await startPromise;
      if (startResult._tag === "Failure") {
        failure = startResult;
      } else {
        turnStartSucceeded = true;
        setKeepFullHistory(routeThreadKey, false);
        if (freshArm !== undefined) disarmFreshSession(routeThreadKey, freshArm);
        clearUsageLimitsFor(routeThreadKey);
        // A draft still on screen finalizes once its thread route takes over.
        if (sentDraftThreadRef) {
          if (backgroundDraftOpened || currentRouteThreadKeyRef.current !== routeThreadKey) {
            finalizePromotedDraftThreadByRef(sentDraftThreadRef);
          } else {
            clearBackgroundDraftSubmissionByRef(sentDraftThreadRef);
          }
        }
        if (backgroundThreadRef) {
          if (backgroundDraftOpened) {
            toastManager.add(
              stackedThreadToast({
                type: "success",
                title: "Started in background",
                timeout: 5_000,
                actionProps: {
                  children: "Open",
                  onClick: () => {
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: buildThreadRouteParams(backgroundThreadRef),
                    });
                  },
                },
              }),
            );
          }
        } else if (
          submissionIntent === "background" &&
          currentRouteThreadKeyRef.current === routeThreadKey
        ) {
          handleNewThreadInActiveProject();
        }
      }
    }

    if (failure !== null) {
      if (isLocalDraftThread && draftId && draftThread) {
        restoreFailedDraftThread(
          draftId,
          draftThread,
          wasBootstrapThreadDeleted(squashAtomCommandFailure(failure))
            ? newThreadId()
            : threadIdForSend,
        );
        clearBackgroundDraftSubmissionByRef(scopeThreadRef(environmentId, threadIdForSend));
      }
      if (
        !composerDraftHasUserContent(
          useComposerDraftStore.getState().getComposerDraft(composerDraftTarget),
        )
      ) {
        setOptimisticUserMessages((existing) => {
          const next = existing.filter((message) => message.id !== messageIdForSend);
          return next.length === existing.length ? existing : next;
        });
        // The restored draft clones its images, so the sent copies are no longer used.
        optimisticBlobPreviews.release(optimisticMessage);
        const retryComposerImages = restoreComposerDraft(composerDraftTarget, sendSnapshot);
        if (currentRouteThreadKeyRef.current === routeThreadKey) {
          promptRef.current = messageTextForSend;
          composerImagesRef.current = retryComposerImages;
          composerFilesRef.current = composerFilesSnapshot;
          composerRef.current?.resetCursorState({
            cursor: collapseExpandedComposerCursor(messageTextForSend, messageTextForSend.length),
            prompt: messageTextForSend,
            detectTrigger: true,
          });
        }
      }
      if (!isAtomCommandInterrupted(failure)) {
        const error = squashAtomCommandFailure(failure);
        setThreadError(
          threadIdForSend,
          error instanceof Error ? error.message : "Failed to send message.",
        );
        if (
          draftId &&
          (backgroundDraftOpened || currentRouteThreadKeyRef.current !== routeThreadKey)
        ) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title:
                submissionIntent === "background"
                  ? "Background task failed"
                  : "Could not start thread",
              description: error instanceof Error ? error.message : "Failed to send message.",
              actionProps: {
                children: "Open draft",
                onClick: () => {
                  void navigate({ to: "/draft/$draftId", params: { draftId } });
                },
              },
            }),
          );
        }
      }
    }
    sendInFlightRef.current = false;
    setSetupQueueSendThreadKey((current) => (current === activeThreadKey ? null : current));
    if (!turnStartSucceeded) {
      setDockedDraftHeroThreadKey((currentThreadKey) =>
        currentThreadKey === activeThreadKey ? null : currentThreadKey,
      );
      if (!sendQueuesBehindSetup) resetLocalDispatch();
    }
  };

  return { onSend };
}
