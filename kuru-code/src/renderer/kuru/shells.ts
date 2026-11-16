// The projects and threads the T3 Code interface lists, built from what kuru
// code's main process reads of Unharnessed: its session files, the open
// agents, and the app's own notes (settled, pinned, seen). Each Unharnessed
// thread becomes a T3 Code thread shell; a running turn is its active run.
import {
  LOCAL_ENVIRONMENT_ID,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "~/contracts";
import { ROOT_THREAD_LINEAGE, type EnvironmentProject, type EnvironmentThreadShell } from "~/rt/state/models";
import type { ThreadPullRequestLink } from "~/contracts";
import { useStore } from "~/state";
import type { AppState, Project as AppProject, ThreadRow } from "@shared/protocol";

/** The project of threads with no project: Unharnessed sessions started in the home folder. */
export const SCRATCH_PROJECT_ID = ProjectId.make("scratch");

const iso = (ms: number | undefined): string | null =>
  ms === undefined || !Number.isFinite(ms) ? null : new Date(ms).toISOString();

function toProject(project: AppProject, createdAt: string): EnvironmentProject {
  return {
    environmentId: LOCAL_ENVIRONMENT_ID,
    id: ProjectId.make(project.id),
    title: project.name,
    workspaceRoot: project.path,
    defaultModelSelection: null,
    scripts: [],
    pinnedAt: iso(project.pinnedAt),
    archivedAt: iso(project.archivedAt),
    ...(project.faviconPath ? { faviconPath: project.faviconPath } : {}),
    ...(project.projectIcon
      ? { projectIcon: project.projectIcon as NonNullable<EnvironmentProject["projectIcon"]> }
      : {}),
    createdAt,
    updatedAt: createdAt,
    ...(project.missing ? { missing: true } : {}),
  };
}

function scratchProject(home: string): EnvironmentProject {
  const at = new Date(0).toISOString();
  return {
    environmentId: LOCAL_ENVIRONMENT_ID,
    id: SCRATCH_PROJECT_ID,
    title: "No project",
    workspaceRoot: home,
    defaultModelSelection: null,
    scripts: [],
    pinnedAt: null,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    isScratch: true,
  };
}

/**
 * The thread's branch's pull request, as the link T3 Code's server keeps for a pull request a
 * thread created, with the snapshot kuru code's main process read from GitHub.
 */
function toPullRequest(row: ThreadRow): ThreadPullRequestLink | null {
  if (!row.pr) return null;
  const parsed = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\//.exec(row.pr.url);
  if (!parsed) return null;
  const at = iso(row.updated) ?? new Date(0).toISOString();
  return {
    host: parsed[1]!,
    repository: parsed[2]!,
    number: row.pr.number,
    url: row.pr.url,
    source: "created",
    linkedAt: at,
    snapshot: {
      state: row.pr.state,
      title: row.pr.title,
      headBranch: row.branch ?? "",
      baseBranch: "",
      isDraft: row.pr.draft,
      updatedAt: null,
      syncedAt: at,
    },
    stack: null,
  };
}

function toThread(row: ThreadRow): EnvironmentThreadShell {
  const createdAt = iso(row.created) ?? new Date(0).toISOString();
  const updatedAt = iso(row.updated) ?? createdAt;
  const working = row.mark === "working";
  const instanceId = ProviderInstanceId.make(row.provider || "unharnessed");
  const runId = RunId.make(`${row.id}:${row.workingSince ?? row.turnEndedAt ?? row.updated}`);
  const startedAt = iso(row.workingSince) ?? updatedAt;
  const completedAt = working ? null : (iso(row.turnEndedAt) ?? updatedAt);
  // A thread with an unseen ending was last seen before the ending.
  const lastVisitedAt =
    row.mark === "unread" ? createdAt : (iso(row.seenAt) ?? completedAt ?? updatedAt);
  const pullRequest = toPullRequest(row);
  return {
    environmentId: LOCAL_ENVIRONMENT_ID,
    id: ThreadId.make(row.id),
    projectId: row.projectId === null ? SCRATCH_PROJECT_ID : ProjectId.make(row.projectId),
    title: row.title ?? "New thread",
    providerInstanceId: instanceId,
    modelSelection: { instanceId, model: row.model ?? "" },
    branch: row.branch ?? null,
    worktreePath: null,
    latestRun: {
      runId,
      status: working ? "running" : row.failed ? "failed" : "completed",
      requestedAt: startedAt,
      startedAt,
      completedAt,
      assistantMessageId: null,
    },
    runtime: working
      ? {
          status: "running",
          activeRunId: runId,
          activityStartedAt: startedAt,
          providerInstanceId: instanceId,
          providerName: row.provider ?? null,
          lastError: null,
          updatedAt,
        }
      : row.failed
        ? {
            status: "failed",
            activeRunId: null,
            providerInstanceId: instanceId,
            providerName: row.provider ?? null,
            lastError: "The turn failed.",
            updatedAt,
          }
        : null,
    latestUserMessageAt: startedAt,
    latestUserAuthoredMessageAt: startedAt,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    providerInstanceHistory: [],
    createdAt,
    updatedAt,
    archivedAt: iso(row.archivedAt),
    settledOverride: row.settled ? "settled" : row.unsettledAt !== undefined ? "active" : null,
    settledAt: row.settled ? (iso(row.settledAt) ?? updatedAt) : null,
    unsettledAt: iso(row.unsettledAt),
    snoozedUntil: row.snoozedUntil ?? null,
    snoozedAt: row.snoozedAt ?? null,
    pinnedAt: row.pinned ? (iso(row.pinnedAt) ?? updatedAt) : null,
    autoSettleDisabledAt: iso(row.autoSettleDisabledAt),
    pinOrderKey: row.pinOrderKey ?? null,
    activeOrderKey: row.activeOrderKey ?? null,
    linkedPullRequest: null,
    branchPullRequest: null,
    pullRequests: pullRequest === null ? [] : [pullRequest],
    lastVisitedAt,
    deletedAt: null,
    lineage: ROOT_THREAD_LINEAGE,
    interactionMode: "default",
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
  };
}

interface Shells {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly threadByKey: ReadonlyMap<string, EnvironmentThreadShell>;
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
}

const EMPTY: Shells = { projects: [], threads: [], threadByKey: new Map(), projectByKey: new Map() };
let built: { app: AppState; rows: Map<ThreadRow, EnvironmentThreadShell>; shells: Shells } | null =
  null;

/** The shells of an app state; a thread row that did not change keeps its shell (and its render). */
export function shellsOf(app: AppState | null): Shells {
  if (app === null) return EMPTY;
  if (built?.app === app) return built.shells;
  const previous = built?.rows ?? new Map<ThreadRow, EnvironmentThreadShell>();
  const previousByKey = built?.shells.threadByKey;
  const rows = new Map<ThreadRow, EnvironmentThreadShell>();
  const threads = app.threads.map((row) => {
    let shell = previous.get(row);
    if (!shell) {
      shell = toThread(row);
      const before = previousByKey?.get(`${LOCAL_ENVIRONMENT_ID}:${row.id}`);
      if (before && JSON.stringify(before) === JSON.stringify(shell)) shell = before;
    }
    rows.set(row, shell);
    return shell;
  });
  const epoch = new Date(0).toISOString();
  const projects = [
    ...app.projects.map((project) => toProject(project, epoch)),
    scratchProject(app.home),
  ];
  const shells: Shells = {
    projects,
    threads,
    threadByKey: new Map(threads.map((thread) => [`${thread.environmentId}:${thread.id}`, thread])),
    projectByKey: new Map(
      projects.map((project) => [`${project.environmentId}:${project.id}`, project]),
    ),
  };
  built = { app, rows, shells };
  return shells;
}

export function readShells(): Shells {
  return shellsOf(useStore.getState().app);
}

export function useShells(): Shells {
  return shellsOf(useStore((state) => state.app));
}

export function useThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  return useShells().threads;
}

export function useProjects(): ReadonlyArray<EnvironmentProject> {
  return useShells().projects;
}

export function readThreadShell(ref: ScopedThreadRef): EnvironmentThreadShell | null {
  return readShells().threadByKey.get(`${ref.environmentId}:${ref.threadId}`) ?? null;
}

export function useThreadShell(ref: ScopedThreadRef | null): EnvironmentThreadShell | null {
  const shells = useShells();
  return ref === null ? null : (shells.threadByKey.get(`${ref.environmentId}:${ref.threadId}`) ?? null);
}

export function readProject(ref: ScopedProjectRef): EnvironmentProject | null {
  return readShells().projectByKey.get(`${ref.environmentId}:${ref.projectId}`) ?? null;
}

export function useProject(ref: ScopedProjectRef | null): EnvironmentProject | null {
  const shells = useShells();
  return ref === null
    ? null
    : (shells.projectByKey.get(`${ref.environmentId}:${ref.projectId}`) ?? null);
}

/** The folder a project's threads run in, as kuru code's main process names projects. */
export function appProjectIdOf(projectId: ProjectId): string | null {
  return projectId === SCRATCH_PROJECT_ID ? null : projectId;
}
