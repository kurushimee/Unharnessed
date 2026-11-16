import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DEFAULT_PREFS, type AppPrefs, type Project, type ProjectIconOverride, type PullRequestRef } from "@shared/protocol";

/** What the app keeps of a thread beside its session file. */
export type ThreadMeta = {
  settledAt?: number;
  pinnedAt?: number;
  /** When it was taken back out of Settled, ms. */
  unsettledAt?: number;
  /** Its place among pinned threads, and among active ones (T3 Code's fractional order keys). */
  pinOrderKey?: string;
  activeOrderKey?: string;
  /** Snoozed until then (ISO time), since `snoozedAt`. */
  snoozedUntil?: string;
  snoozedAt?: string;
  /** Kept out of automatic settling since then, ms. */
  autoSettleDisabledAt?: number;
  /** Archived then, ms: out of the sidebar, in Settings' archived threads. */
  archivedAt?: number;
  /** When it was last on screen, and when its last turn ended (and whether it failed), ms. */
  seenAt?: number;
  turnEndedAt?: number;
  failed?: boolean;
  /** A title the user gave it. */
  title?: string;
  /** A turn ended in it while another thread was on screen, not seen since. */
  unread?: boolean;
  /** The branch its folder was on when its last turn ended. */
  branch?: string;
  /** Its branch's pull request, when last looked up. */
  pr?: PullRequestRef | null;
  prCheckedAt?: number;
};

type SavedProject = {
  path: string;
  name?: string;
  addedAt: number;
  pinnedAt?: number;
  archivedAt?: number;
  projectIcon?: ProjectIconOverride;
  faviconPath?: string;
};

/** What the window may change of a project; `null` clears a field. */
export type ProjectChange = {
  title?: string | null;
  pinned?: boolean;
  archived?: boolean;
  projectIcon?: ProjectIconOverride | null;
  faviconPath?: string | null;
};

type Saved = {
  version: 1;
  projects: SavedProject[];
  /** Projects removed from the sidebar: their threads' folders are not added back. */
  hidden: string[];
  threads: Record<string, ThreadMeta>;
  prefs: AppPrefs;
  window?: { x?: number; y?: number; width: number; height: number; maximized: boolean };
  /** The folder the last thread started in: the next start's. */
  lastCwd?: string;
  /** The window's client settings (T3 Code's ClientSettings), as it last wrote them. */
  clientSettings?: Record<string, unknown>;
};

/** A folder's project id: Windows paths are compared without case. */
export function projectId(path: string): string {
  const full = resolve(path).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? full.toLowerCase() : full;
}

export function projectName(path: string): string {
  return basename(resolve(path)) || path;
}

/**
 * The app's state file (`state.json` in the user data folder): the
 * projects, what each thread is beside its session file (settled, pinned,
 * its title, branch and pull request), the preferences and the window.
 * Written a moment after each change, through a temporary file.
 */
export class Store {
  private data: Saved;
  private timer: NodeJS.Timeout | undefined;
  private readonly file: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "state.json");
    this.data = { version: 1, projects: [], hidden: [], threads: {}, prefs: { ...DEFAULT_PREFS } };
    try {
      const read = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Saved>;
      this.data = {
        version: 1,
        projects: read.projects ?? [],
        hidden: read.hidden ?? [],
        threads: read.threads ?? {},
        prefs: { ...DEFAULT_PREFS, ...read.prefs },
        window: read.window,
        lastCwd: read.lastCwd,
        clientSettings: read.clientSettings,
      };
    } catch {
      // A first start.
    }
  }

  get prefs(): AppPrefs {
    return this.data.prefs;
  }

  setPrefs(prefs: Partial<AppPrefs>): void {
    this.data.prefs = { ...this.data.prefs, ...prefs };
    this.save();
  }

  get clientSettings(): Record<string, unknown> | null {
    return this.data.clientSettings ?? null;
  }

  setClientSettings(settings: Record<string, unknown>): void {
    this.data.clientSettings = settings;
    this.save();
  }

  get lastCwd(): string | undefined {
    return this.data.lastCwd;
  }

  set lastCwd(cwd: string | undefined) {
    if (this.data.lastCwd === cwd) return;
    this.data.lastCwd = cwd;
    this.save();
  }

  get window(): Saved["window"] {
    return this.data.window;
  }

  setWindow(window: NonNullable<Saved["window"]>): void {
    this.data.window = window;
    this.save();
  }

  /** The projects added, and the folders threads ran in (but the home folder and hidden ones). */
  projects(threadCwds: string[], home: string): Project[] {
    const byId = new Map<string, Project>();
    const homeId = projectId(home);
    const hidden = new Set(this.data.hidden);
    for (const saved of this.data.projects) {
      const id = projectId(saved.path);
      byId.set(id, {
        id,
        path: saved.path,
        name: saved.name ?? projectName(saved.path),
        missing: !existsSync(saved.path) || undefined,
        pinnedAt: saved.pinnedAt,
        archivedAt: saved.archivedAt,
        projectIcon: saved.projectIcon,
        faviconPath: saved.faviconPath,
      });
    }
    for (const cwd of threadCwds) {
      const id = projectId(cwd);
      if (!cwd || id === homeId || byId.has(id) || hidden.has(id)) continue;
      byId.set(id, { id, path: cwd, name: projectName(cwd), missing: !existsSync(cwd) || undefined });
    }
    return [...byId.values()];
  }

  addProject(path: string): string {
    const id = projectId(path);
    this.data.hidden = this.data.hidden.filter((hidden) => hidden !== id);
    if (!this.data.projects.some((project) => projectId(project.path) === id)) {
      this.data.projects.push({ path, addedAt: Date.now() });
    }
    this.save();
    return id;
  }

  /** Changes a project; one only found through its threads is added to the saved ones first. */
  updateProject(id: string, path: string, change: ProjectChange): void {
    let saved = this.data.projects.find((project) => projectId(project.path) === id);
    if (!saved) {
      saved = { path, addedAt: Date.now() };
      this.data.projects.push(saved);
    }
    if (change.title !== undefined) saved.name = change.title?.trim() || undefined;
    if (change.pinned !== undefined) saved.pinnedAt = change.pinned ? (saved.pinnedAt ?? Date.now()) : undefined;
    if (change.archived !== undefined) saved.archivedAt = change.archived ? (saved.archivedAt ?? Date.now()) : undefined;
    if (change.projectIcon !== undefined) saved.projectIcon = change.projectIcon ?? undefined;
    if (change.faviconPath !== undefined) saved.faviconPath = change.faviconPath ?? undefined;
    this.save();
  }

  removeProject(id: string): void {
    this.data.projects = this.data.projects.filter((project) => projectId(project.path) !== id);
    if (!this.data.hidden.includes(id)) this.data.hidden.push(id);
    this.save();
  }

  thread(id: string): ThreadMeta {
    return this.data.threads[id] ?? {};
  }

  setThread(id: string, change: Partial<ThreadMeta>): void {
    const next: ThreadMeta = { ...this.data.threads[id], ...change };
    for (const key of Object.keys(next) as (keyof ThreadMeta)[]) {
      if (next[key] === undefined) delete next[key];
    }
    this.data.threads[id] = next;
    this.save();
  }

  forgetThread(id: string): void {
    delete this.data.threads[id];
    this.save();
  }

  private save(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const temp = `${this.file}.tmp`;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(temp, JSON.stringify(this.data, null, 2));
    renameSync(temp, this.file);
  }
}
