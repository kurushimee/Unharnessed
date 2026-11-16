// Adapted from T3 Code's hooks/useHandleNewThread.ts: a new thread in a
// project opens as a draft (its project's, reused while nothing is asked in
// it) at /draft/$draftId. kuru code's window then shows a new Unharnessed
// conversation in the project's folder; its first prompt saves it.
import { scopedProjectKey, scopeProjectRef } from "~/rt/environment/index";
import { LOCAL_ENVIRONMENT_ID, ThreadId, type ScopedProjectRef } from "~/contracts";
import { useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  DraftId,
  type DraftThreadEnvMode,
  useComposerDraftStore,
} from "../composerDraftStore";
import { randomUUID } from "../lib/utils";
import { orderItemsByPreferredIds } from "../components/Sidebar.logic";
import { readProject, useProjects, useThreadShell } from "../state/entities";
import type { EnvironmentProject } from "~/rt/state/models";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../uiStateStore";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./useLocalStorage";
import { useThreadRouteTarget } from "./useThreadRouteTarget";

export const LAST_USED_PROJECT_STORAGE_KEY = "t3code:last-used-project:v1";
export const lastUsedProjectKeySchema = Schema.NullOr(Schema.String);

export function readLastUsedProjectKey(): string | null {
  try {
    return getLocalStorageItem(LAST_USED_PROJECT_STORAGE_KEY, lastUsedProjectKeySchema);
  } catch {
    return null;
  }
}

const getProjectOrderKey = (project: EnvironmentProject) =>
  scopedProjectKey(scopeProjectRef(project.environmentId, project.id));

export function useNewThreadHandler() {
  const router = useRouter();
  return async (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      startFromOrigin?: boolean;
      replace?: boolean;
      prompt?: string;
    },
  ): Promise<{ draftId: DraftId; threadId: ThreadId } | null> => {
    const project = readProject(projectRef);
    if (!project) return null;
    const store = useComposerDraftStore.getState();
    const existing = store.getDraftSessionByProjectRef(projectRef);
    let draftId: DraftId;
    let threadId: ThreadId;
    if (existing && options?.branch === undefined) {
      draftId = existing.draftId;
      threadId = existing.threadId;
    } else {
      draftId = DraftId.make(randomUUID());
      threadId = ThreadId.make(randomUUID());
      store.setProjectDraftThreadId(projectRef, draftId, {
        threadId,
        createdAt: new Date().toISOString(),
        branch: options?.branch ?? null,
        worktreePath: options?.worktreePath ?? null,
        envMode: options?.envMode ?? "local",
      });
    }
    if (options?.prompt !== undefined && !store.getComposerDraft(draftId)?.prompt.trim()) {
      store.setPrompt(draftId, options.prompt);
    }
    setLocalStorageItem(
      LAST_USED_PROJECT_STORAGE_KEY,
      scopedProjectKey(projectRef),
      lastUsedProjectKeySchema,
    );
    await router.navigate({
      to: "/draft/$draftId",
      params: { draftId },
      ...(options?.replace ? { replace: true } : {}),
    });
    return { draftId, threadId };
  };
}

export function resolveDefaultProjectRef(
  projects: ReadonlyArray<EnvironmentProject>,
  projectOrder: readonly string[],
  lastUsedProjectKey: string | null,
): ScopedProjectRef | null {
  const lastUsed = projects.find(
    (project) =>
      project.archivedAt == null &&
      !project.isScratch &&
      scopedProjectKey(scopeProjectRef(project.environmentId, project.id)) === lastUsedProjectKey,
  );
  if (lastUsed) return scopeProjectRef(lastUsed.environmentId, lastUsed.id);
  const [defaultProject] = orderItemsByPreferredIds({
    items: projects.filter((project) => project.archivedAt == null && !project.isScratch),
    preferredIds: projectOrder,
    getId: getProjectOrderKey,
    getPreferenceIds: (project) => [
      getProjectOrderKey(project),
      legacyProjectCwdPreferenceKey(project.workspaceRoot),
    ],
  });
  return defaultProject ? scopeProjectRef(defaultProject.environmentId, defaultProject.id) : null;
}

export function useHandleNewThread() {
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const [lastUsedProjectKey] = useLocalStorage(
    LAST_USED_PROJECT_STORAGE_KEY,
    null,
    lastUsedProjectKeySchema,
  );
  const routeTarget = useThreadRouteTarget();
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const routeDraftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const activeThread = useThreadShell(routeThreadRef) ?? undefined;
  const activeDraftThread = useComposerDraftStore((store) =>
    routeDraftId ? store.getDraftSession(routeDraftId) : null,
  );
  const projects = useProjects();
  const handleNewThread = useNewThreadHandler();
  const defaultProjectRef = resolveDefaultProjectRef(projects, projectOrder, lastUsedProjectKey);
  void LOCAL_ENVIRONMENT_ID;
  return {
    activeDraftThread,
    activeThread,
    defaultProjectRef,
    defaultProjectFallbackReady: true,
    handleNewThread,
    routeDraftId,
    routeThreadRef,
  };
}
