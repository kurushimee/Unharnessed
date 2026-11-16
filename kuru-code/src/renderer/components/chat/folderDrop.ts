export function resolveDroppedFolderPath(
  folder: File,
  getPathForFile: ((file: File) => string) | undefined,
): string | null {
  const path = getPathForFile?.(folder);
  return typeof path === "string" && path.length > 0 ? path : null;
}
