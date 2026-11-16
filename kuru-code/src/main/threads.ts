import { existsSync, watch, type FSWatcher } from "node:fs";
import type { LogOutputChannel } from "vscode";
import type { SavedSession } from "../../../vscode/src/agent";
import { Conversation } from "../../../vscode/src/conversations";
import type { Files as PanelFiles } from "../../../vscode/src/files";
import type { ShownAgent } from "../../../vscode/src/shown";
import type { AppState, Attachment, Draft, ThreadRow } from "@shared/protocol";
import { Files } from "./files";
import type { Git } from "./git";
import { tagged } from "./log";
import { listSessions, sessionsDir, type SessionSummary } from "./sessions";
import { projectId, type Store, type ThreadMeta } from "./store";

/** A thread in the background sleeps after this long without work, like the extension's conversations. */
const SLEEP_AFTER_MS = 90 * 60_000;
/** A pull request is looked up again after this long. */
const PR_TTL_MS = 5 * 60_000;
const NO_DRAFT: Draft = { text: "", images: [] };
const DELETE = "_unharnessed/sessions/delete";

/**
 * The threads: the saved conversations of every project, as the session
 * files tell them, and the open ones, one agent process each (the
 * extension's Conversation: its session, chat and kernel). The one on
 * screen is the shown one; the others keep working and sleep after a while
 * without work, like the extension's (vscode/src/conversations.ts), but
 * each in its own project's folder.
 */
export class Threads {
  private readonly open: Conversation[] = [];
  private shownOne: Conversation | undefined;
  private nextTag = 1;
  private readonly cwds = new WeakMap<Conversation, string>();
  private readonly files = new WeakMap<Conversation, Files>();
  /** When each opened saved thread had last changed, before it opened. */
  private readonly idle = new WeakMap<Conversation, number>();
  private readonly worked = new Map<Conversation, boolean>();
  /** When each working thread's running turn started, ms, by id. */
  private readonly workingSince = new Map<string, number>();
  private readonly timers = new Map<Conversation, NodeJS.Timeout>();
  /** Agents still stopping, by id: one holds its file until it exits. */
  private readonly stopping = new Map<string, Promise<void>>();
  private sessions: SessionSummary[] = [];
  private loaded = false;
  private watcher: FSWatcher | undefined;
  private rescan: NodeJS.Timeout | undefined;
  private emitTimer: NodeJS.Timeout | undefined;
  private readonly prLookups = new Set<string>();
  /** The window's ids of new threads whose session is not made yet, or not yet noted. */
  private readonly aliases = new WeakMap<Conversation, string>();
  private readonly createListeners = new Set<(conversation: Conversation) => void>();
  private readonly showListeners = new Set<() => void>();
  private readonly appListeners = new Set<(app: AppState) => void>();
  private readonly doneListeners = new Set<(done: { id: string; title?: string; failed: boolean; shown: boolean }) => void>();

  constructor(
    private readonly binary: string,
    private readonly version: string,
    private readonly home: string,
    private readonly shownAgent: ShownAgent,
    private readonly store: Store,
    private readonly git: Git,
    private readonly log: LogOutputChannel,
    private readonly sleepAfter = SLEEP_AFTER_MS,
  ) {}

  get shown(): Conversation {
    if (!this.shownOne) throw new Error("no thread yet");
    return this.shownOne;
  }

  isShown(conversation: Conversation): boolean {
    return conversation === this.shownOne;
  }

  cwdOf(conversation: Conversation): string {
    return this.cwds.get(conversation) ?? this.home;
  }

  /** The `@` menu's files of the thread's folder. */
  filesOf(conversation: Conversation): Files {
    return this.files.get(conversation) ?? new Files(this.cwdOf(conversation), this.log, false);
  }

  onCreate(listener: (conversation: Conversation) => void): void {
    this.createListeners.add(listener);
  }

  onShow(listener: () => void): void {
    this.showListeners.add(listener);
  }

  onApp(listener: (app: AppState) => void): void {
    this.appListeners.add(listener);
  }

  /** A turn ended in a thread: the window tells, when it is not the one on screen or the window is away. */
  onDone(listener: (done: { id: string; title?: string; failed: boolean; shown: boolean }) => void): void {
    this.doneListeners.add(listener);
  }

  /** The first thread: a new one in `cwd`, and the sessions folder read and watched. */
  async start(cwd: string): Promise<void> {
    this.begin(undefined, cwd, NO_DRAFT);
    await this.refresh();
    try {
      this.watcher = watch(sessionsDir(), () => this.scheduleRescan());
    } catch (error) {
      this.log.warn(`threads: the sessions folder is not watched: ${String(error)}`);
    }
  }

  /** The session id of a thread the window names: its own, or the one its alias stands for. */
  resolve(id: string): string {
    for (const session of this.sessions) if (this.store.thread(session.id).alias === id) return session.id;
    for (const conversation of this.open) {
      if (this.aliases.get(conversation) === id && conversation.id) return conversation.id;
    }
    return id;
  }

  /** The id the window knows a thread by: its alias, else its session id. */
  private windowId(conversation: Conversation): string | undefined {
    const pending = this.aliases.get(conversation);
    if (pending) return pending;
    const { id } = conversation;
    return id ? (this.store.thread(id).alias ?? id) : undefined;
  }

  private openByWindowId(id: string): Conversation | undefined {
    return this.open.find((conversation) => this.windowId(conversation) === id || conversation.id === id);
  }

  /**
   * A message to the thread `id`, on screen: an open one, a saved one (its
   * agent starts on it), or a new one in `cwd` that `id` then names.
   */
  send(id: string, cwd: string, text: string, images: Attachment[], now: boolean): void {
    let conversation = this.openByWindowId(id);
    if (conversation) this.show(conversation, NO_DRAFT);
    else if (this.sessions.some((session) => session.id === this.resolve(id))) {
      this.openSaved(this.resolve(id));
      conversation = this.shownOne;
    } else {
      const shown = this.shownOne;
      conversation =
        shown && shown.empty && this.cwdOf(shown) === cwd && !this.aliases.has(shown)
          ? shown
          : this.begin(undefined, cwd, NO_DRAFT);
      this.aliases.set(conversation, id);
      this.log.info(`threads: [${conversation.tag}] is the window's ${id}`);
    }
    conversation?.chat.send(text, images, undefined, now);
  }

  /** Stops the running turn of the thread `id`, open on screen or not. */
  cancel(id: string): void {
    this.openByWindowId(id)?.chat.cancel();
  }

  /** A new thread on screen, in `cwd`; `draft` stays with the one it leaves. */
  newChat(cwd: string, draft: Draft = NO_DRAFT): void {
    const shown = this.shownOne;
    // A new thread in the same folder as the empty one on screen is that one.
    if (shown && shown.empty && this.cwdOf(shown) === cwd) {
      this.emit();
      return;
    }
    this.begin(undefined, cwd, draft);
  }

  /** A saved thread on screen: as it is when it is open, else its agent starts on its file. */
  openSaved(windowId: string, draft: Draft = NO_DRAFT): void {
    const open = this.openByWindowId(windowId);
    const id = this.resolve(windowId);
    if (open) {
      this.show(open, draft);
      return;
    }
    const summary = this.sessions.find((session) => session.id === id);
    if (!summary) {
      this.log.warn(`threads: ${id} is not a saved thread`);
      return;
    }
    const conversation = this.begin({ id, path: summary.path }, summary.cwd || this.home, draft);
    this.idle.set(conversation, summary.updated);
  }

  /** The thread on screen starts again on its file. */
  restart(): Promise<void> {
    this.log.info(`threads: [${this.shown.tag}] restarts`);
    return this.shown.restart();
  }

  /** Deletes a saved thread: its agent stops first (it holds the file); the one on screen gives way to a new one. */
  async remove(windowId: string): Promise<string | undefined> {
    const conversation = this.openByWindowId(windowId);
    const id = this.resolve(windowId);
    if (conversation && conversation === this.shownOne) this.begin(undefined, this.cwdOf(conversation), NO_DRAFT);
    if (conversation) await this.close(conversation, "deleted");
    try {
      await this.shownAgent.request(DELETE, { sessionId: id });
      this.log.info(`threads: ${id} deleted`);
      this.store.forgetThread(id);
      await this.refresh();
      return undefined;
    } catch (error) {
      const text = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error);
      this.log.warn(`threads: delete of ${id} refused: ${text}`);
      return text;
    }
  }

  /** The window closes: every agent stops at once, each saving its kernel. */
  async stopAll(): Promise<void> {
    this.watcher?.close();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.all(this.open.map((conversation) => conversation.agent.stop()));
  }

  /** The thread's id was seen on screen. */
  seen(windowId: string): void {
    const id = this.resolve(windowId);
    this.store.setThread(id, { unread: undefined, seenAt: Date.now() });
    this.emit();
  }

  /** The thread's sidebar state changed (settled, pinned, its order, unread...). */
  setMeta(windowId: string, change: Partial<ThreadMeta>): void {
    this.store.setThread(this.resolve(windowId), change);
    this.emit();
  }

  get app(): AppState {
    const shown = this.shownOne;
    const shownCwd = shown ? this.cwdOf(shown) : this.home;
    const homeId = projectId(this.home);
    const projects = this.store.projects(
      this.sessions.map((session) => session.cwd),
      this.home,
    );
    const known = new Set(projects.map((project) => project.id));
    const projectOf = (cwd: string) => {
      const id = projectId(cwd || this.home);
      return id === homeId || !known.has(id) ? null : id;
    };
    const threads: ThreadRow[] = this.sessions.map((session) => {
      const meta = this.store.thread(session.id);
      const conversation = this.open.find((open) => open.id === session.id);
      const working = conversation?.chat.working ?? false;
      const unread = !working && meta.unread === true && conversation !== shown;
      const config = conversation?.session.current;
      let provider = session.provider;
      let model = session.model;
      if (config?.kind === "open" && config.config.model) {
        const current = config.config.model.choices.find((choice) => choice.value === config.config.model?.current);
        if (current) {
          provider = current.provider;
          model = current.id;
        }
      }
      const row: ThreadRow = {
        id: meta.alias ?? session.id,
        projectId: projectOf(session.cwd),
        cwd: session.cwd,
        title: meta.title ?? session.title,
        created: session.created,
        updated: session.updated,
        branch: meta.branch ?? session.branch,
        provider,
        model,
        settled: meta.settledAt !== undefined,
        pinned: meta.pinnedAt !== undefined,
        settledAt: meta.settledAt,
        pinnedAt: meta.pinnedAt,
        unsettledAt: meta.unsettledAt,
        pinOrderKey: meta.pinOrderKey,
        activeOrderKey: meta.activeOrderKey,
        autoSettleDisabledAt: meta.autoSettleDisabledAt,
        archivedAt: meta.archivedAt,
        workingSince: working ? this.workingSince.get(session.id) : undefined,
        turnEndedAt: meta.turnEndedAt,
        failed: meta.failed,
        seenAt: meta.seenAt,
      };
      if (working) row.mark = "working";
      else if (unread) row.mark = "unread";
      if (meta.pr) row.pr = meta.pr;
      return row;
    });
    return {
      projects,
      threads,
      shown: {
        id: shown ? this.windowId(shown) : undefined,
        cwd: shownCwd,
        projectId: projectOf(shownCwd),
        draft: shown ? shown.empty : true,
        idleSince: shown ? this.idle.get(shown) : undefined,
      },
      home: this.home,
      loaded: this.loaded,
    };
  }

  /** The saved threads' files and projects, for searching their messages. */
  get searchable(): { id: string; path: string; projectId: string | null }[] {
    const app = this.app;
    const projectById = new Map(app.threads.map((row) => [row.id, row.projectId]));
    const projectOfSession = (session: SessionSummary) =>
      projectById.get(this.store.thread(session.id).alias ?? session.id) ?? null;
    return this.sessions.map((session) => ({
      id: this.store.thread(session.id).alias ?? session.id,
      path: session.path,
      projectId: projectOfSession(session),
    }));
  }

  /** Reads the sessions folder again, then tells the window. */
  async refresh(): Promise<void> {
    this.sessions = await listSessions();
    this.loaded = true;
    this.lookUpPullRequests();
    this.emit();
  }

  emit(): void {
    this.emitTimer ??= setTimeout(() => {
      this.emitTimer = undefined;
      const app = this.app;
      for (const listener of this.appListeners) listener(app);
    }, 30);
  }

  private scheduleRescan(): void {
    clearTimeout(this.rescan);
    this.rescan = setTimeout(() => void this.refresh(), 400);
  }

  /** The pull requests of the threads' branches, looked up again after a while. */
  private lookUpPullRequests(): void {
    const now = Date.now();
    for (const session of this.sessions) {
      const meta = this.store.thread(session.id);
      const branch = meta.branch ?? session.branch;
      if (!branch || !session.cwd || !existsSync(session.cwd)) continue;
      if (meta.prCheckedAt !== undefined && now - meta.prCheckedAt < PR_TTL_MS) continue;
      const key = `${session.cwd}\0${branch}`;
      if (this.prLookups.has(key)) continue;
      this.prLookups.add(key);
      void this.git
        .github(session.cwd)
        .then((repo) => (repo ? this.git.pullRequestFor(session.cwd, branch) : null))
        .then((pr) => {
          for (const other of this.sessions) {
            if (other.cwd !== session.cwd || (this.store.thread(other.id).branch ?? other.branch) !== branch) continue;
            this.store.setThread(other.id, {
              pr: pr && { number: pr.number, title: pr.title, url: pr.url, state: pr.state, draft: pr.draft },
              prCheckedAt: Date.now(),
            });
          }
          this.emit();
        })
        .finally(() => this.prLookups.delete(key));
    }
  }

  /** A new agent, on a new thread or on `saved`, on screen. */
  private begin(saved: SavedSession | undefined, cwd: string, draft: Draft): Conversation {
    const conversation = this.create(saved, cwd);
    if (saved) conversation.chat.reset(true);
    this.show(conversation, draft);
    const stopping = saved && this.stopping.get(saved.id);
    if (stopping) void stopping.then(() => conversation.agent.start(saved));
    else conversation.agent.start(saved);
    return conversation;
  }

  private create(saved: SavedSession | undefined, cwd: string): Conversation {
    const tag = this.nextTag++;
    const log = tagged(this.log, tag);
    const files = new Files(cwd, log, projectId(cwd) !== projectId(this.home));
    const conversation = new Conversation(tag, this.binary, cwd, this.version, files as unknown as PanelFiles, log, () =>
      this.newChat(cwd),
    );
    this.cwds.set(conversation, cwd);
    this.files.set(conversation, files);
    this.store.lastCwd = cwd;
    this.open.push(conversation);
    this.shownAgent.attach(conversation.agent);
    const update = () => this.update(conversation);
    conversation.agent.onChange(update);
    conversation.chat.onPost(update);
    conversation.kernel.onChange(update);
    conversation.session.onChange(update);
    for (const listener of this.createListeners) listener(conversation);
    this.log.info(`threads: [${tag}] ${saved ? `opens ${saved.id}` : "new"} in ${cwd}`);
    return conversation;
  }

  private show(next: Conversation, draft: Draft): void {
    const left = this.shownOne;
    if (left === next) return;
    if (left) left.draft = draft;
    this.shownOne = next;
    this.shownAgent.show(next.agent);
    this.update(next);
    this.log.info(`threads: [${next.tag}] on screen`);
    for (const listener of this.showListeners) listener();
    this.emit();
    if (!left) return;
    if (left.empty) void this.close(left, "nothing asked in it");
    else this.update(left);
  }

  /** It started or stopped working: its mark, its branch, and whether it may sleep. */
  private update(conversation: Conversation): void {
    if (!this.open.includes(conversation)) return;
    const working = conversation.chat.working;
    const before = this.worked.get(conversation) ?? false;
    this.worked.set(conversation, working);
    const away = conversation !== this.shownOne;
    const { id } = conversation;
    const alias = this.aliases.get(conversation);
    if (alias && id) {
      this.store.setThread(id, { alias });
      this.aliases.delete(conversation);
      this.emit();
    }
    if (!before && working && id) this.workingSince.set(id, Date.now());
    if (before && !working && id) {
      this.workingSince.delete(id);
      this.ended(conversation, id, away);
    }
    if (!away && id && this.store.thread(id).unread) this.store.setThread(id, { unread: undefined });
    if (before !== working) {
      this.emit();
      // A first prompt writes the file: the sidebar lists it.
      if (working) this.scheduleRescan();
    }
    if (!away || conversation.busy) this.disarm(conversation);
    else if (!this.timers.has(conversation)) this.arm(conversation);
  }

  /** A turn ended: unread when away, its branch read again, the window told. */
  private ended(conversation: Conversation, id: string, away: boolean): void {
    if (away) {
      this.store.setThread(id, { unread: true });
      this.log.info(`threads: [${conversation.tag}] done in the background`);
    }
    const last = conversation.chat.current.entries.findLast((entry) => entry.kind === "turn");
    const failed = last?.kind === "turn" && last.state === "failed";
    this.store.setThread(id, { turnEndedAt: Date.now(), failed: failed || undefined, ...(away ? {} : { seenAt: Date.now() }) });
    const title = this.store.thread(id).title ?? this.sessions.find((session) => session.id === id)?.title;
    const windowId = this.store.thread(id).alias ?? id;
    for (const listener of this.doneListeners) listener({ id: windowId, title, failed, shown: !away });
    const cwd = this.cwdOf(conversation);
    void this.git.branch(cwd).then((branch) => {
      const meta = this.store.thread(id);
      if (branch !== meta.branch) this.store.setThread(id, { branch, prCheckedAt: undefined });
      void this.refresh();
    });
  }

  private arm(conversation: Conversation): void {
    const timer = setTimeout(() => {
      this.timers.delete(conversation);
      if (conversation === this.shownOne || conversation.busy) return;
      void this.close(conversation, `asleep after ${Math.round(this.sleepAfter / 60_000)} min without work`);
    }, this.sleepAfter);
    this.timers.set(conversation, timer);
  }

  private disarm(conversation: Conversation): void {
    clearTimeout(this.timers.get(conversation));
    this.timers.delete(conversation);
  }

  private async close(conversation: Conversation, why: string): Promise<void> {
    const at = this.open.indexOf(conversation);
    if (at < 0) return;
    this.open.splice(at, 1);
    this.disarm(conversation);
    this.worked.delete(conversation);
    this.shownAgent.detach(conversation.agent);
    this.log.info(`threads: [${conversation.tag}] closes (${why})`);
    const { id } = conversation;
    const stopped = conversation.agent.stop();
    if (id) this.stopping.set(id, stopped);
    await stopped;
    if (id && this.stopping.get(id) === stopped) this.stopping.delete(id);
    this.emit();
  }
}
