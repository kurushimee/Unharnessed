// The projects and threads the T3 Code interface lists, built from what kuru
// code's main process reads of Unharnessed: its session files, the open
// agents, and the app's own notes (settled, pinned, seen). Each Unharnessed
// thread becomes the shell T3 Code's server would send (its wire shell); a
// running turn is its active run. T3 Code's own shell atoms
// (rt/state/threadShell.ts) and presentation (rt/state/models.ts) read them.
import * as DateTime from "effect/DateTime";
import { Atom } from "effect/reactivity";
import {
  LOCAL_ENVIRONMENT_ID,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ThreadShell,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "~/contracts";
import {
  presentThreadShell,
  rootThreadLineage,
  type EnvironmentProject,
  type EnvironmentThreadShell,
} from "~/rt/state/models";
import { createEnvironmentThreadShellAtoms } from "~/rt/state/threadShell";
import type { EnvironmentCatalogState } from "~/rt/state/connections";
import type { ThreadPullRequestLink } from "~/contracts";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useStore } from "~/state";
import type { AppState, Project as AppProject, ThreadRow } from "@shared/protocol";

/** The project of threads with no project: Unharnessed sessions started in the home folder. */
export const SCRATCH_PROJECT_ID = ProjectId.make("scratch");

const iso = (ms: number | undefined): string | null =>
  ms === undefined || !Number.isFinite(ms) ? null : new Date(ms).toISOString();
const utc = (ms: number): DateTime.Utc => DateTime.makeUnsafe(ms);
const utcOrNull = (ms: number | undefined): DateTime.Utc | null =>
  ms === undefined || !Number.isFinite(ms) ? null : utc(ms);

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

/** The shell T3 Code's server would send for an Unharnessed thread. */
function toWireThread(row: ThreadRow): OrchestrationV2ThreadShell {
  const created = row.created;
  const updated = row.updated ?? created;
  const working = row.mark === "working";
  const instanceId = ProviderInstanceId.make(row.provider || "unharnessed");
  const runId = RunId.make(`${row.id}:${row.workingSince ?? row.turnEndedAt ?? row.updated}`);
  const started = row.workingSince ?? updated;
  const pullRequest = toPullRequest(row);
  const threadId = ThreadId.make(row.id);
  // A thread with an unseen ending was last seen before the ending.
  const visited = row.mark === "unread" ? created : (row.seenAt ?? (working ? undefined : (row.turnEndedAt ?? updated)));
  return {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: row.projectId === null ? SCRATCH_PROJECT_ID : ProjectId.make(row.projectId),
    title: row.title ?? "New thread",
    providerInstanceId: instanceId,
    modelSelection: { instanceId, model: row.model || "unknown" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: row.branch || null,
    worktreePath: null,
    linkedPullRequest: null,
    branchPullRequest: null,
    pullRequests: pullRequest === null ? [] : [pullRequest],
    lineage: rootThreadLineage(threadId),
    forkedFrom: null,
    activeProviderThreadId: null,
    latestRunId: runId,
    latestRunRequestedAt: utc(started),
    latestRunStartedAt: utc(started),
    latestRunCompletedAt: working ? null : utc(row.turnEndedAt ?? updated),
    activeRunId: working ? runId : null,
    activityRunStartedAt: working ? utc(started) : null,
    activityRunStatus: working ? "running" : null,
    status: working ? "running" : row.failed ? "failed" : "idle",
    lastError: row.failed && !working ? "The turn failed." : null,
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: utc(started),
    latestUserAuthoredMessageAt: utc(started),
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    providerInstanceHistory: [],
    goal: null,
    itemCount: 1,
    visibleItemCount: 1,
    createdAt: utc(created),
    updatedAt: utc(updated),
    archivedAt: utcOrNull(row.archivedAt),
    settledOverride: row.settled ? "settled" : row.unsettledAt !== undefined ? "active" : null,
    settledAt: row.settled ? utc(row.settledAt ?? updated) : null,
    unsettledAt: utcOrNull(row.unsettledAt),
    pinnedAt: row.pinned ? utc(row.pinnedAt ?? updated) : null,
    autoSettleDisabledAt: utcOrNull(row.autoSettleDisabledAt),
    pinOrderKey: row.pinOrderKey ?? null,
    activeOrderKey: row.activeOrderKey ?? null,
    lastVisitedAt: utcOrNull(visited),
    deletedAt: null,
  };
}

interface Shells {
  readonly snapshot: OrchestrationV2ShellSnapshot;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly threadByKey: ReadonlyMap<string, EnvironmentThreadShell>;
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
}

const EMPTY_SNAPSHOT: OrchestrationV2ShellSnapshot = {
  schemaVersion: 1,
  snapshotSequence: 0,
  threads: [],
  archivedThreads: [],
  projects: [],
};
const EMPTY: Shells = { snapshot: EMPTY_SNAPSHOT, projects: [], threads: [], threadByKey: new Map(), projectByKey: new Map() };
let built: {
  app: AppState;
  rows: Map<ThreadRow, { wire: OrchestrationV2ThreadShell; shell: EnvironmentThreadShell }>;
  shells: Shells;
} | null = null;
let sequence = 0;

/** The shells of an app state; a thread row that did not change keeps its shell (and its render). */
export function shellsOf(app: AppState | null): Shells {
  if (app === null) return EMPTY;
  if (built?.app === app) return built.shells;
  const previous = built?.rows ?? new Map();
  const previousById = new Map<string, { wire: OrchestrationV2ThreadShell; shell: EnvironmentThreadShell }>();
  for (const [row, value] of previous) previousById.set(row.id, value);
  const rows = new Map<ThreadRow, { wire: OrchestrationV2ThreadShell; shell: EnvironmentThreadShell }>();
  for (const row of app.threads) {
    let value = previous.get(row);
    if (!value) {
      const wire = toWireThread(row);
      const before = previousById.get(row.id);
      value =
        before && JSON.stringify(before.wire) === JSON.stringify(wire)
          ? before
          : { wire, shell: presentThreadShell(LOCAL_ENVIRONMENT_ID, wire) };
    }
    rows.set(row, value);
  }
  const all = [...rows.values()];
  const live = all.filter((value) => value.wire.archivedAt === null);
  const archived = all.filter((value) => value.wire.archivedAt !== null);
  const epoch = new Date(0).toISOString();
  const projects = [...app.projects.map((project) => toProject(project, epoch)), scratchProject(app.home)];
  const threads = all.map((value) => value.shell);
  const shells: Shells = {
    snapshot: {
      schemaVersion: 1,
      snapshotSequence: ++sequence,
      threads: live.map((value) => value.wire),
      archivedThreads: archived.map((value) => value.wire),
      projects: projects.map(({ environmentId: _environment, isScratch: _scratch, ...project }) => project),
    },
    projects,
    threads,
    threadByKey: new Map(threads.map((thread) => [`${thread.environmentId}:${thread.id}`, thread])),
    projectByKey: new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project])),
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
  return ref === null ? null : (shells.projectByKey.get(`${ref.environmentId}:${ref.projectId}`) ?? null);
}

/** The folder a project's threads run in, as kuru code's main process names projects. */
export function appProjectIdOf(projectId: ProjectId): string | null {
  return projectId === SCRATCH_PROJECT_ID ? null : projectId;
}

// The shells as T3 Code's thread shell atoms read them: a snapshot of kuru
// code's one environment, the way T3 Code's server sends its shell.
const snapshotAtom = Atom.make<OrchestrationV2ShellSnapshot | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("kuru:shell-snapshot"),
);

export const environmentCatalogAtom = Atom.make<EnvironmentCatalogState>({
  isReady: true,
  entries: new Map([[LOCAL_ENVIRONMENT_ID, { enabled: true }]]),
}).pipe(Atom.keepAlive, Atom.withLabel("kuru:environment-catalog"));

const NO_SNAPSHOT = Atom.make<OrchestrationV2ShellSnapshot | null>(null);
const NO_TAGS = Atom.make<ReadonlyArray<string> | null>(null);

export const shellSnapshotAtom = (environmentId: string) =>
  environmentId === LOCAL_ENVIRONMENT_ID ? snapshotAtom : NO_SNAPSHOT;

export const environmentThreadShells = createEnvironmentThreadShellAtoms({
  catalogValueAtom: environmentCatalogAtom,
  snapshotAtom: shellSnapshotAtom,
  // kuru code filters no threads by tag.
  hiddenThreadTagsAtom: () => NO_TAGS,
});

let shellsFollowed = false;
/** Keeps the shell snapshot up with the app state, for the window's life. */
export function startShellAtoms(): void {
  if (shellsFollowed) return;
  shellsFollowed = true;
  const publish = (app: AppState | null) =>
    appAtomRegistry.set(snapshotAtom, app === null || !app.loaded ? null : shellsOf(app).snapshot);
  publish(useStore.getState().app);
  useStore.subscribe((state, previous) => {
    if (state.app !== previous.app) publish(state.app);
  });
}

const projectsAtom = Atom.make((get): ReadonlyArray<EnvironmentProject> => {
  get(snapshotAtom);
  return readShells().projects;
}).pipe(Atom.withLabel("kuru:projects"));
const projectFamily = Atom.family((key: string) =>
  Atom.make((get) => get(projectsAtom).find((project) => `${project.environmentId}:${project.id}` === key) ?? null),
);

/** T3 Code's environment projects atoms (state/projects.ts), over kuru code's projects. */
export const environmentProjects = {
  projectsAtom,
  projectAtom: (ref: ScopedProjectRef) => projectFamily(`${ref.environmentId}:${ref.projectId}`),
};

/** Whether the shell has been read: the sessions folder's first read. */
export const shellsBootstrappedAtom = Atom.make((get) => get(snapshotAtom) !== null).pipe(
  Atom.withLabel("kuru:shells-bootstrapped"),
);
