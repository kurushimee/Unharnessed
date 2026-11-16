import type { EnvironmentThreadShell } from "~/rt/state/models";
import { providerSettingsRowId } from "../settings/agentSettingsCommon";
import type { UnifiedSettings } from "~/contracts";
import type { ComposerThreadTarget, DraftSessionState } from "../../composerDraftStore";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useApplyThreadModelPick } from "./useApplyThreadModelPick";
import {
  type ModelSelection,
  ProviderInstanceId,
  type ServerProvider,
} from "~/contracts";
import type { deriveThreadStructureRuntime } from "~/rt/state/threadExecution";
import { scopeThreadRef } from "~/rt/environment/index";
import { useNavigate } from "@tanstack/react-router";
import { toastManager } from "../ui/toast";
import { resolveAppModelSelectionForInstance } from "../../modelSelection";
import { useComposerDraftStore } from "../../composerDraftStore";
import {
  getStartedThreadModelChangeBlockReason,
  deriveLockedProvider,
  makeModelDisabledReason,
} from "../ChatView.logic";
interface ComposerSelectionInput {
  readonly composerDraftTarget: ComposerThreadTarget;
  readonly draftThread: DraftSessionState | null;
  readonly activeThread: EnvironmentThreadShell | undefined;
  readonly activeRuntime: ReturnType<typeof deriveThreadStructureRuntime>;
  readonly settings: UnifiedSettings;
  readonly providerStatuses: ReadonlyArray<ServerProvider>;
  readonly lockedProvider: ReturnType<typeof deriveLockedProvider>;
  readonly supportsProviderSwitchingViaHandoff: boolean;
  readonly isLocalDraftThread: boolean;
  readonly scheduleComposerFocus: () => void;
}

/**
 * The composer's choices for the next turn: provider and model.
 */
export function useComposerSelection(input: ComposerSelectionInput) {
  const {
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
  } = input;
  const navigate = useNavigate();
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const applyThreadModelPick = useApplyThreadModelPick();

  const openProviderSetup = (instanceId: ProviderInstanceId) => {
    // kuru code's provider instance is the provider: its row on the providers page.
    void navigate({ to: "/settings/providers", hash: providerSettingsRowId(instanceId) });
  };
  const openProviderSetupStable = useStableCallback(openProviderSetup);

  // Keyed on the fields it reads: the thread and runtime objects change with
  // every streamed event, and a new function re-renders the whole model picker.
  const hasStartedSession = activeRuntime !== null;
  const runtimeProviderInstanceId = activeRuntime?.providerInstanceId ?? null;
  const currentModelSelection = activeThread?.modelSelection ?? null;
  const getModelDisabledReason = makeModelDisabledReason(
    currentModelSelection
      ? {
          hasStartedSession,
          supportsProviderSwitchingViaHandoff,
          currentModelSelection,
          currentProviderInstanceId: runtimeProviderInstanceId,
        }
      : null,
  );

  const onProviderModelSelect = (
    instanceId: ProviderInstanceId,
    model: string,
    options?: { focusComposer?: boolean },
  ) => {
    if (!activeThread) return;
    const entry = providerStatuses.find((snapshot) => snapshot.instanceId === instanceId);
    const resolvedDriverKind = entry?.driver ?? null;
    if (
      !supportsProviderSwitchingViaHandoff &&
      lockedProvider !== null &&
      resolvedDriverKind !== null &&
      resolvedDriverKind !== lockedProvider
    ) {
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    if (
      !supportsProviderSwitchingViaHandoff &&
      lockedProvider !== null &&
      activeRuntime?.providerInstanceId
    ) {
      const currentEntry = providerStatuses.find(
        (snapshot) => snapshot.instanceId === activeRuntime.providerInstanceId,
      );
      if (
        currentEntry?.continuation?.groupKey &&
        entry?.continuation?.groupKey &&
        currentEntry.continuation.groupKey !== entry.continuation.groupKey
      ) {
        if (options?.focusComposer !== false) scheduleComposerFocus();
        return;
      }
    }
    const resolvedModel = resolveAppModelSelectionForInstance(
      instanceId,
      settings,
      providerStatuses,
      model,
    );
    if (!resolvedModel) {
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    const rememberedOptions =
      useComposerDraftStore.getState().stickyOptionsByModelByProvider[instanceId]?.[resolvedModel];
    const nextModelSelection: ModelSelection =
      rememberedOptions !== undefined && rememberedOptions.length > 0
        ? { instanceId, model: resolvedModel, options: [...rememberedOptions] }
        : { instanceId, model: resolvedModel };
    const modelChangeBlockReason = getStartedThreadModelChangeBlockReason({
      hasStartedSession: activeRuntime !== null,
      supportsProviderSwitchingViaHandoff,
      currentModelSelection: activeThread.modelSelection,
      currentProviderInstanceId: activeRuntime?.providerInstanceId ?? null,
      nextModelSelection,
    });
    if (modelChangeBlockReason) {
      toastManager.add({
        type: "warning",
        title: modelChangeBlockReason.title,
        description: modelChangeBlockReason.description,
      });
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    const threadRef = scopeThreadRef(activeThread.environmentId, activeThread.id);
    setComposerDraftModelSelection(threadRef, nextModelSelection, {
      explicit: true,
      replaceOptions: true,
    });
    setStickyComposerModelSelection(nextModelSelection);
    if (!isLocalDraftThread) applyThreadModelPick(threadRef);
    if (options?.focusComposer !== false) scheduleComposerFocus();
  };
  const onProviderModelSelectStable = useStableCallback(onProviderModelSelect);
  return {
    getModelDisabledReason,
    onProviderModelSelectStable,
    openProviderSetupStable,
  };
}
