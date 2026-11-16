import { type NewProjectPublishTarget } from "~/rt/operations/projects";
import { type ReactNode } from "react";

import { sourceControlIcon } from "~/sourceControlPresentation";
import { Button } from "./ui/button";
import { Kbd, KbdGroup } from "./ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function sourceControlHostIcon(
  definition: NewProjectPublishTarget["definition"],
  className: string,
): ReactNode {
  const Icon = sourceControlIcon(definition);
  return <Icon className={className} />;
}

/** The input's trailing submit button for the add-project, clone, and new-project flows. */
export function CommandPaletteSubmitButton(props: {
  readonly id: string;
  readonly label: ReactNode;
  readonly shortcutLabel: string;
  readonly ariaLabel: string;
  readonly tooltip: ReactNode;
  readonly disabled: boolean;
  readonly onSubmit: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            id={props.id}
            variant="outline"
            size="xs"
            className="absolute inset-e-2.5 top-1/2 -translate-y-1/2"
            aria-label={props.ariaLabel}
            disabled={props.disabled}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={props.onSubmit}
          />
        }
      >
        <span>{props.label}</span>
        <KbdGroup className="pointer-events-none -me-0.5">
          <Kbd>{props.shortcutLabel}</Kbd>
        </KbdGroup>
      </TooltipTrigger>
      <TooltipPopup side="top">{props.tooltip}</TooltipPopup>
    </Tooltip>
  );
}

