import { SquareMenuIcon } from "lucide-react";
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
