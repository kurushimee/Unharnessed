import type { ProviderInstanceId } from "~/contracts";
import { type ComponentProps, memo } from "react";

import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { ProviderModelPicker } from "./ProviderModelPicker";

export const ComposerFooterPrimaryActions = memo(function ComposerFooterPrimaryActions(props: {
  children?: React.ReactNode;
  compact: boolean;
  canOperateThread: boolean;
  pendingAction: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    isResponding: boolean;
    isComplete: boolean;
  } | null;
  isRunning: boolean;
  canInterrupt: boolean;
  followUpBehavior: "queue" | "steer";
  canSteer: boolean;
  alternateShortcutLabel: string | null;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  hasSendableContent: boolean;
  canResume: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  isEditingQueuedMessage: boolean;
  onSubmitMessage: React.MouseEventHandler<HTMLButtonElement>;
  onResume: () => void;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  compactBeforeSendTokens: number | null;
  keepFullHistory: boolean;
  onToggleKeepFullHistory: () => void;
}) {
  return (
    <>
      <ComposerPrimaryActions
        compact={props.compact}
        canOperateThread={props.canOperateThread}
        pendingAction={props.pendingAction}
        isRunning={props.isRunning}
        canInterrupt={props.canInterrupt}
        followUpBehavior={props.followUpBehavior}
        canSteer={props.canSteer}
        alternateShortcutLabel={props.alternateShortcutLabel}
        isSendBusy={props.isSendBusy}
        sendDisabledReason={props.sendDisabledReason}
        hasSendableContent={props.hasSendableContent}
        canResume={props.canResume}
        preserveComposerFocusOnPointerDown={props.preserveComposerFocusOnPointerDown ?? false}
        isEditingQueuedMessage={props.isEditingQueuedMessage}
        onSubmitMessage={props.onSubmitMessage}
        onResume={props.onResume}
        onPreviousPendingQuestion={props.onPreviousPendingQuestion}
        onInterrupt={props.onInterrupt}
        compactBeforeSendTokens={props.compactBeforeSendTokens}
        keepFullHistory={props.keepFullHistory}
        onToggleKeepFullHistory={props.onToggleKeepFullHistory}
      >
        {props.children}
      </ComposerPrimaryActions>
    </>
  );
});

/** The composer's model picker. */
export function ComposerModelPicker({
  onProviderModelSelect,
  ...pickerProps
}: Omit<ComponentProps<typeof ProviderModelPicker>, "onInstanceModelChange"> & {
  readonly onProviderModelSelect: (
    instanceId: ProviderInstanceId,
    model: string,
    options?: { focusComposer?: boolean },
  ) => void;
}) {
  return (
    <ProviderModelPicker
      {...pickerProps}
      onInstanceModelChange={(instanceId, model) => onProviderModelSelect(instanceId, model)}
    />
  );
}
