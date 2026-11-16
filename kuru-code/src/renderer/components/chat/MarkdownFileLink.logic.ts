import { splitFilePathPosition } from "~/shared/fileLinks";

import type { MarkdownFileLinkMeta } from "../../markdown-links";

export function markdownFileCopyMenuItems({
  targetPath,
  workspaceRelativePath,
}: Pick<MarkdownFileLinkMeta, "targetPath" | "workspaceRelativePath">) {
  const items = [
    { id: "copy-full", label: "Copy full path", value: targetPath, title: "Full path" },
  ];
  if (workspaceRelativePath !== null) {
    const position = targetPath.slice(splitFilePathPosition(targetPath).path.length);
    items.unshift({
      id: "copy-relative",
      label: "Copy relative path",
      value: `${workspaceRelativePath}${position}`,
      title: "Relative path",
    });
  }
  return items;
}
