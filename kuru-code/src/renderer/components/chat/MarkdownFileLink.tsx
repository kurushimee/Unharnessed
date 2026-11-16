import { formatFilePathForClipboard } from "~/rt/mediaActions";
import type { EnvironmentId } from "~/contracts";
import { memo, type MouseEvent as ReactMouseEvent } from "react";

import { readLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import type { markdownFileCopyPaths } from "../../markdownFileHostPath";
import { documentChipKindForFileName } from "../../pierre-icons";
import { ContextChip } from "../ContextChip";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { FileTagChipContent } from "./FileTagChip";
import { markdownFileCopyMenuItems } from "./MarkdownFileLink.logic";
import { reportMarkdownActionFailure } from "./markdownActionFailure";
import { WorkspaceEntryTooltip } from "./WorkspaceEntryIcon";

interface MarkdownFileLinkProps {
  environmentId: EnvironmentId | null;
  href: string;
  targetPath: string;
  iconPath: string;
  workspaceRelativePath: string | null;
  label: string;
  copyMarkdown: string;
  theme: "light" | "dark";
  resolveCopyPaths: () => Promise<ReturnType<typeof markdownFileCopyPaths>>;
  onOpenMedia?: (() => void) | undefined;
}

const MARKDOWN_FILE_LINK_CLASS_NAME = "chat-markdown-file-link";

export const MarkdownFileLink = memo(function MarkdownFileLink({
  environmentId,
  href,
  targetPath,
  iconPath,
  workspaceRelativePath,
  label,
  copyMarkdown,
  theme,
  onOpenMedia,
  resolveCopyPaths,
}: MarkdownFileLinkProps) {
  const handleCopy = (resolveValue: () => Promise<string>, title: string) => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Failed to copy ${title.toLowerCase()}`,
          description: "Clipboard API unavailable.",
        }),
      );
      return;
    }

    const value = resolveValue().then((text) => formatFilePathForClipboard(text, targetPath));
    // Start the write before workspace lookup finishes so Safari retains the user gesture.
    const write =
      typeof navigator.clipboard.write === "function" && typeof ClipboardItem !== "undefined"
        ? navigator.clipboard.write([
            new ClipboardItem({
              "text/plain": value.then((text) => new Blob([text], { type: "text/plain" })),
            }),
          ])
        : value.then((text) => navigator.clipboard.writeText(text));
    void Promise.all([write, value]).then(
      ([, text]) => {
        toastManager.add({
          type: "success",
          title: `${title} copied`,
          description: text,
        });
      },
      (error) => {
        reportMarkdownActionFailure(
          { operation: "copy-file-path", target: targetPath, copyTarget: title },
          error,
        );
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Failed to copy ${title.toLowerCase()}`,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      },
    );
  };

  const showFileContextMenu = async (position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;

    try {
      const copyItems = markdownFileCopyMenuItems({ targetPath, workspaceRelativePath });
      const clicked = await api.contextMenu.show(
        [
          ...(onOpenMedia ? ([{ id: "preview-media", label: "Preview media" }] as const) : []),
          ...copyItems.map(({ id, label }) => ({ id, label })),
        ] as const,
        position,
      );

      if (clicked === "preview-media") {
        onOpenMedia?.();
        return;
      }
      if (clicked === "copy-relative" || clicked === "copy-full") {
        handleCopy(
          () =>
            resolveCopyPaths().then((paths) =>
              clicked === "copy-relative" ? paths.relativePath : paths.fullPath,
            ),
          clicked === "copy-relative" ? "Relative path" : "Full path",
        );
      }
    } catch (cause) {
      reportMarkdownActionFailure(
        { operation: "show-file-context-menu", target: targetPath },
        cause,
      );
    }
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const position =
      event.clientX === 0 && event.clientY === 0
        ? (() => {
            const bounds = event.currentTarget.getBoundingClientRect();
            return { x: bounds.left, y: bounds.bottom };
          })()
        : { x: event.clientX, y: event.clientY };
    void showFileContextMenu(position);
  };

  const chipKind = documentChipKindForFileName(iconPath) ?? "mention";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          onOpenMedia ? (
            <ContextChip
              kind={chipKind}
              dir="ltr"
              render={<a href={href} />}
              className={MARKDOWN_FILE_LINK_CLASS_NAME}
              data-markdown-copy={copyMarkdown}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenMedia();
              }}
              onContextMenu={handleContextMenu}
            >
              <FileTagChipContent
                path={iconPath}
                environmentId={environmentId}
                label={label}
                theme={theme}
              />
            </ContextChip>
          ) : (
            <ContextChip
              kind={chipKind}
              dir="ltr"
              render={<button type="button" />}
              aria-label={`File options for ${label}`}
              aria-haspopup="menu"
              className={cn(MARKDOWN_FILE_LINK_CLASS_NAME, "select-text")}
              data-markdown-copy={copyMarkdown}
              onClick={handleContextMenu}
              onContextMenu={handleContextMenu}
            >
              <FileTagChipContent
                path={iconPath}
                environmentId={environmentId}
                label={label}
                theme={theme}
              />
            </ContextChip>
          )
        }
      />
      <TooltipPopup side="top" variant="code">
        <WorkspaceEntryTooltip path={iconPath} label={targetPath} environmentId={environmentId} />
      </TooltipPopup>
    </Tooltip>
  );
}, areMarkdownFileLinkPropsEqual);

function areMarkdownFileLinkPropsEqual(
  previous: Readonly<MarkdownFileLinkProps>,
  next: Readonly<MarkdownFileLinkProps>,
): boolean {
  return (
    previous.href === next.href &&
    previous.targetPath === next.targetPath &&
    previous.iconPath === next.iconPath &&
    previous.environmentId === next.environmentId &&
    previous.workspaceRelativePath === next.workspaceRelativePath &&
    previous.label === next.label &&
    previous.copyMarkdown === next.copyMarkdown &&
    previous.theme === next.theme &&
    previous.onOpenMedia === next.onOpenMedia &&
    previous.resolveCopyPaths === next.resolveCopyPaths
  );
}
