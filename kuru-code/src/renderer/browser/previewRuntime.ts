// T3 Code's browser/previewRuntime.ts: whether its preview browser can show a
// page here. kuru code has no preview browser; pages open in the system one.
import type { EnvironmentId } from "~/contracts";

export function isPreviewAvailableFor(_environmentId: EnvironmentId | null): boolean {
  return false;
}
