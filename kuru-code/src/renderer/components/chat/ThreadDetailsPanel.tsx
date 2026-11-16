import type { EnvironmentId, ProjectId, ThreadId } from "~/contracts";

import type { DraftId } from "../../composerDraftStore";
import { BranchToolbar } from "../BranchToolbar";
import BaseGitActionsControl from "../GitActionsControl";
import { memo, useState, type ComponentProps } from "react";
import { ThreadDetailsCard } from "./ThreadDetailsCard";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ThreadDetailsContext, ThreadDetailsUsage, type ThreadDetailsUsageInput } from "./ThreadDetailsUsage";
import { ThreadDetailsItemsMenuItems } from "./ThreadDetailsItemsMenu";
import { resolveThreadDetailsVisibility, THREAD_DETAILS_ITEMS } from "./threadDetailsItems";
import { useClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { SlidersHorizontalIcon } from "lucide-react";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_ICON_CLASS, THREAD_DETAILS_PANEL_LABEL_CLASS } from "./threadDetailsPanelStyles";
import { Menu, MenuPopup } from "../ui/menu";

const GitActionsControl = memo(BaseGitActionsControl);

interface ThreadDetailsPanelProps extends Pick<
  ComponentProps<typeof ThreadDetailsCard>,
  "anchor" | "handle"
> {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  projectId: ProjectId;
  draftId?: DraftId;
  activeProjectName: string | undefined;
  gitCwd: string | null;
  isGitRepo: boolean;
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (branch: string | null) => void;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest: () => void;
  usage: ThreadDetailsUsageInput;
}

export function ThreadDetailsPanel(props: ThreadDetailsPanelProps) {
  const visible = useClientSettings(resolveThreadDetailsVisibility);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const activeThreadRef = { environmentId: props.environmentId, threadId: props.threadId };
  const branchToolbarProps = {
    showGitControls: props.isGitRepo,
    environmentId: props.environmentId,
    threadId: props.threadId,
    projectId: props.projectId,
    ...(props.draftId ? { draftId: props.draftId } : {}),
    ...(props.activeThreadBranchOverride !== undefined
      ? { activeThreadBranchOverride: props.activeThreadBranchOverride }
      : {}),
    ...(props.onActiveThreadBranchOverrideChange
      ? { onActiveThreadBranchOverrideChange: props.onActiveThreadBranchOverrideChange }
      : {}),
    onComposerFocusRequest: props.onComposerFocusRequest,
    ...(props.onCheckoutPullRequestRequest
      ? { onCheckoutPullRequestRequest: props.onCheckoutPullRequestRequest }
      : {}),
  };

  return (
    <ThreadDetailsCard
      threadRef={{ environmentId: props.environmentId, threadId: props.threadId }}
      anchor={props.anchor}
      handle={props.handle}
      contentKey={THREAD_DETAILS_ITEMS.filter((item) => visible[item.id])
        .map((item) => item.id)
        .join(",")}
      onContextMenu={(event) => {
        // Popups the card opens bubble here through React; they, fields, links, and selected text
        // keep their own menus.
        const target = event.target;
        const selection = window.getSelection();
        if (
          !(target instanceof Element) ||
          !event.currentTarget.contains(target) ||
          target.closest("input, textarea, [contenteditable], a[href]") ||
          (selection &&
            !selection.isCollapsed &&
            (event.currentTarget.contains(selection.anchorNode) ||
              event.currentTarget.contains(selection.focusNode)))
        )
          return;
        event.preventDefault();
        setMenuPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      {(density) => {
        // Section flags follow the rows that will render, so no empty section steals the divider rule.
        const show = {
          branch: props.gitCwd !== null && props.isGitRepo && visible.branch,
          git:
            props.gitCwd !== null &&
            props.activeProjectName !== undefined &&
            (visible.gitActions || (visible.changes && props.isGitRepo)),
        };
        return (
          <>
            <div className="group/details-items">
              {props.gitCwd && (show.branch || show.git) ? (
                <ThreadDetailsSection
                  headingId="thread-details-version-control-heading"
                  title="Version Control"
                  showHeading={false}
                  separated={false}
                >
                  <div className="flex flex-col">
                    {show.branch ? (
                      <BranchToolbar layout="panel" {...branchToolbarProps} />
                    ) : null}
                    {show.git ? (
                      <GitActionsControl
                        compact={density !== "full"}
                        showActions={visible.gitActions}
                        showChanges={visible.changes}
                        gitCwd={props.gitCwd}
                        activeThreadRef={activeThreadRef}
                        {...(props.draftId ? { draftId: props.draftId } : {})}
                      />
                    ) : null}
                  </div>
                </ThreadDetailsSection>
              ) : null}

              {visible.usage ? <ThreadDetailsUsage {...props.usage} /> : null}

              {visible.context && props.usage.contextWindow ? (
                <ThreadDetailsContext usage={props.usage.contextWindow} />
              ) : null}

              {/* Shown only when no section above has content, so an emptied card can be refilled. */}
              <div className="p-2 group-has-[>section>:last-child:not(:empty)]/details-items:hidden">
                <ThreadDetailsControl
                  size="xs"
                  variant="ghost"
                  part="row"
                  panel
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenuPosition({ x: rect.left, y: rect.bottom });
                  }}
                >
                  <SlidersHorizontalIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
                  <span className={cn("ml-0.5", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
                    Choose what to show
                  </span>
                </ThreadDetailsControl>
              </div>
            </div>

            <Menu
              open={menuPosition !== null}
              onOpenChange={(open) => !open && setMenuPosition(null)}
            >
              <MenuPopup
                anchor={
                  menuPosition
                    ? {
                        getBoundingClientRect: () =>
                          new DOMRect(menuPosition.x, menuPosition.y, 0, 0),
                      }
                    : undefined
                }
                align="start"
                side="bottom"
              >
                <ThreadDetailsItemsMenuItems />
              </MenuPopup>
            </Menu>
          </>
        );
      }}
    </ThreadDetailsCard>
  );
}
