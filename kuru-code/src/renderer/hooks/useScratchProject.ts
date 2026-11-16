// Adapted from T3 Code's hooks/useScratchProject.ts. T3 Code asks a server
// to open its scratch folder as a project; kuru code's threads without a
// project run in the home folder, listed under its No project entry.
import { scopeProjectRef } from "~/rt/environment/index";
import type { EnvironmentId } from "~/contracts";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { SCRATCH_PROJECT_ID, readProject } from "~/kuru/shells";
import { useServerConfigs } from "~/kuru/environment";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useNewThreadHandler } from "./useHandleNewThread";

export function useScratchProject() {
  const serverConfigs = useServerConfigs();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const handleNewThread = useNewThreadHandler();
  const scratchWorkspaceRootFor = (environmentId: EnvironmentId | null): string | null =>
    environmentId === null ? null : (serverConfigs.get(environmentId)?.scratchWorkspaceRoot ?? null);
  const scratchEnvironmentId = (fallback: EnvironmentId | null): EnvironmentId | null => {
    if (scratchWorkspaceRootFor(primaryEnvironmentId) !== null) return primaryEnvironmentId;
    return fallback !== null && scratchWorkspaceRootFor(fallback) !== null ? fallback : null;
  };
  const openScratchProject = async (environmentId: EnvironmentId) =>
    readProject(scopeProjectRef(environmentId, SCRATCH_PROJECT_ID));
  const startScratchThread = async (environmentId: EnvironmentId) => {
    await handleNewThread(scopeProjectRef(environmentId, SCRATCH_PROJECT_ID)).catch((error: unknown) =>
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not start without a project",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      ),
    );
  };
  return { scratchWorkspaceRootFor, scratchEnvironmentId, openScratchProject, startScratchThread };
}
