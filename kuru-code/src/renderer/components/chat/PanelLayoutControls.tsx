import { Maximize2Icon, Minimize2Icon, PanelRightIcon, SquareMenuIcon } from "lucide-react";
import { memo, type ReactNode } from "react";

import type { ThreadPanelPresentation } from "../../threadPanelStore";
import { PopoverCreateHandle, PopoverTrigger } from "../ui/popover";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface PanelLayoutControlsProps {
  threadPanelOpen: boolean;
  threadPanelPresentation: ThreadPanelPresentation;
  threadPanelPopoverHandle?: ReturnType<typeof PopoverCreateHandle>;
  threadPanelShortcutLabel: string | null;
  onToggleThreadPanel: () => void;
}

export const PanelLayoutControls = memo(function PanelLayoutControls({
  threadPanelOpen,
  threadPanelPresentation,
  threadPanelPopoverHandle,
  threadPanelShortcutLabel,
  onToggleThreadPanel,
}: PanelLayoutControlsProps) {
  const threadPanelToggle = (
    <Toggle
      className="relative shrink-0 [-webkit-app-region:no-drag]"
      pressed={threadPanelOpen}
      onPressedChange={threadPanelPresentation === "popover" ? undefined : onToggleThreadPanel}
      aria-label="Toggle thread details panel"
      variant="ghost"
      size="sm"
    >
      <SquareMenuIcon className="size-4" />
    </Toggle>
  );

  return (
    <div
      className="flex h-full shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
      data-panel-layout-controls
    >
      <Tooltip>
        <TooltipTrigger render={<span className="flex shrink-0" />}>
          {threadPanelPresentation === "popover" ? (
            <PopoverTrigger handle={threadPanelPopoverHandle} render={threadPanelToggle} />
          ) : (
            threadPanelToggle
          )}
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          Toggle thread details
          {threadPanelShortcutLabel ? ` (${threadPanelShortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});

/** The pull requests page's right panel toggle. */
export const RightPanelToggleControl = memo(function RightPanelToggleControl({
  available,
  open,
  shortcutLabel,
  unavailableLabel,
  onToggle,
}: {
  available: boolean;
  open: boolean;
  shortcutLabel: string | null;
  unavailableLabel: string;
  onToggle: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0" />}>
        <Toggle
          className="shrink-0 [-webkit-app-region:no-drag]"
          pressed={open}
          onPressedChange={onToggle}
          aria-label="Toggle right panel"
          data-right-panel-toggle
          variant="ghost"
          size="sm"
          disabled={!available}
        >
          <PanelRightIcon className="size-4" />
        </Toggle>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {available
          ? `Toggle right panel${shortcutLabel ? ` (${shortcutLabel})` : ""}`
          : unavailableLabel}
      </TooltipPopup>
    </Tooltip>
  );
});

export const RightPanelMaximizeControl = memo(function RightPanelMaximizeControl({
  maximized,
  onToggle,
}: {
  maximized: boolean;
  onToggle: () => void;
}) {
  const label = maximized ? "Restore panel size" : "Maximize panel";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0 [-webkit-app-region:no-drag]"
            pressed={maximized}
            onPressedChange={onToggle}
            aria-label={label}
            variant="ghost"
            size="sm"
          >
            {maximized ? (
              <Minimize2Icon className="size-4" />
            ) : (
              <Maximize2Icon className="size-4" />
            )}
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
});

/** The window's top-right panel controls. */
export function WorkspaceTitlebarControls(props: { readonly children: ReactNode }) {
  return (
    <div
      className="pointer-events-none fixed top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] z-50 mr-px flex h-[var(--workspace-topbar-height)] items-center gap-1 [-webkit-app-region:no-drag]"
      data-workspace-titlebar-controls
    >
      <div className="pointer-events-auto flex h-full items-center">{props.children}</div>
    </div>
  );
}
