import { ArchiveIcon, ArchiveX, Trash2Icon } from "lucide-react";
import { scopeThreadRef, scopedThreadKey } from "~/rt/environment";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "~/rt/state/runtime";
import { useThreadActions } from "../../hooks/useThreadActions";
import { readLocalApi } from "../../localApi";
import { useShells } from "~/kuru/shells";
import { RelativeTime } from "../RelativeTime";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { ProjectFavicon } from "../ProjectFavicon";

import { useRef, useState } from "react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

const ARCHIVE_ACTIONS = [
  { action: "unarchive", label: "Unarchive", Icon: ArchiveX },
  { action: "delete", label: "Delete", Icon: Trash2Icon },
] as const;
type ArchiveAction = (typeof ARCHIVE_ACTIONS)[number]["action"];

// Adapted from T3 Code's components/settings/ArchivedThreadsPanel.tsx: kuru code has one
// machine, so its archived threads are its own shells, by project.
export function ArchivedThreadsPanel() {
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  const pendingActionsRef = useRef(new Set<string>());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const shells = useShells();

  const archivedGroups = (() => {
    const threads = shells.threads.filter((thread) => thread.archivedAt != null);
    const groups = new Map<
      string,
      {
        readonly project: (typeof shells.projects)[number];
        readonly threads: Array<(typeof threads)[number]>;
      }
    >();
    for (const project of shells.projects) {
      const projectThreads = threads.filter(
        (thread) => thread.projectId === project.id && thread.environmentId === project.environmentId,
      );
      if (projectThreads.length > 0) {
        groups.set(`${project.environmentId}:${project.id}`, { project, threads: projectThreads });
      }
    }
    return Array.from(groups, ([key, group]) => ({
      ...group,
      key,
      title: group.project.title,
      threads: group.threads.toSorted((left, right) => {
        const leftKey = left.archivedAt ?? left.createdAt;
        const rightKey = right.archivedAt ?? right.createdAt;
        return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
      }),
    }));
  })();

  type ArchivedThread = (typeof archivedGroups)[number]["threads"][number];

  const reportFailure = (result: AtomCommandResult<unknown, unknown> | null, title: string) => {
    if (result?._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  };

  const handleThreadAction = async (action: ArchiveAction, thread: ArchivedThread) => {
    const target = scopeThreadRef(thread.environmentId, thread.id);
    const key = scopedThreadKey(target);
    // Context menus can outlive their render, so checks and cleanup use the live set.
    const pending = pendingActionsRef.current;
    if (pending.has(key)) return;
    pending.add(key);
    setPendingKeys(new Set(pending));
    const result = await settlePromise(async () => {
      const result = await (action === "unarchive"
        ? unarchiveThread(target)
        : confirmAndDeleteThread(target, thread.title));
      return result;
    }).finally(() => {
      pending.delete(key);
      setPendingKeys(new Set(pending));
    });
    reportFailure(result._tag === "Failure" ? result : result.value, `Failed to ${action} thread`);
  };

  const handleContextMenu = async (thread: ArchivedThread, position: { x: number; y: number }) => {
    const pending = pendingActionsRef.current;
    if (pending.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)))) return;
    const result = await settlePromise(async () => {
      const clicked = await readLocalApi()?.contextMenu.show(
        ARCHIVE_ACTIONS.map(({ action, label }) => ({
          id: action,
          label,
          destructive: action === "delete",
        })),
        position,
      );
      if (clicked === "unarchive" || clicked === "delete")
        await handleThreadAction(clicked, thread);
    });
    reportFailure(result, "Archived thread action failed");
  };

  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <SettingsSection {...searchableSetting("archive")}>
          <SettingsRow
            title={
              <span className="inline-flex items-center gap-2">
                <ArchiveIcon className="size-3.5 text-muted-foreground" />
                No archived threads
              </span>
            }
            description="Archived threads will appear here."
          />
        </SettingsSection>
      ) : (
        archivedGroups.map(({ key, project, title, threads: projectThreads }, index) => (
          <SettingsSection
            key={key}
            id={index === 0 ? searchableSetting("archive").id : undefined}
            title={title}
            icon={<ProjectFavicon project={project} />}
          >
            {projectThreads.map((thread) => {
              const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
              return (
                <SettingsRow
                  key={`${thread.environmentId}:${thread.id}`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void handleContextMenu(thread, { x: event.clientX, y: event.clientY });
                  }}
                  title={thread.title}
                  description={
                    <span>
                      Archived <RelativeTime timestamp={thread.archivedAt ?? thread.createdAt} />
                      {" \u00b7 Created "}
                      <RelativeTime timestamp={thread.createdAt} />
                    </span>
                  }
                  control={
                    <div className="flex shrink-0 items-center gap-2">
                      {ARCHIVE_ACTIONS.map(({ action, label, Icon }) => (
                        <Tooltip key={action}>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                variant={action === "delete" ? "destructive-outline" : "outline"}
                                size="icon-sm"
                                aria-label={`${label} ${thread.title}`}
                                disabled={pendingKeys.has(threadKey)}
                                onClick={() => void handleThreadAction(action, thread)}
                              />
                            }
                          >
                            <Icon className="size-3.5" />
                          </TooltipTrigger>
                          <TooltipPopup>{label}</TooltipPopup>
                        </Tooltip>
                      ))}
                    </div>
                  }
                />
              );
            })}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
