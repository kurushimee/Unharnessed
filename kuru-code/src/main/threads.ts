import { existsSync, watch, type FSWatcher } from "node:fs";
import type { LogOutputChannel } from "vscode";
import { errorText, type SavedSession } from "../../../vscode/src/agent";
import { Conversation } from "../../../vscode/src/conversations";
import type { Files as PanelFiles } from "../../../vscode/src/files";
import type { ShownAgent } from "../../../vscode/src/shown";
import type { AppState, Attachment, Draft, ThreadRow } from "@shared/protocol";
import { Files } from "./files";
import type { Git } from "./git";
import { tagged } from "./log";
import { listSessions, sessionsDir, type SessionSummary } from "./sessions";
import { projectId, type Store, type ThreadMeta } from "./store";
import { generateThreadTitle, type TitleModel } from "./titles";

/** A thread in the background sleeps after this long without work, like the extension's conversations. */
const SLEEP_AFTER_MS = 90 * 60_000;
/** The usage limit a thread stopped on, read from and changed in its agent. */
const QUOTA = "_unharnessed/session/quota";
/** A thread resumes this long after its usage limit resets, as the agent's own pause does (PROVIDER_RESUME_GRACE_MS). */
const RESUME_GRACE_MS = 30_000;
/** A resume missed by more than this (the app was closed) is dropped, as T3 Code's server does. */
const MAX_OVERDUE_RESUME_MS = 24 * 60 * 60_000;
type QuotaAnswer = { limited: boolean; resetAt: number | null; resumeAt: number | null };

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
  /** The threads whose agent is closed that go on by themselves once a usage limit resets, by id. */
  private readonly resumeTimers = new Map<string, NodeJS.Timeout>();
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
  /** Titles written for threads whose session has no id yet. */
  private readonly titled = new WeakMap<Conversation, string>();
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
    for (const session of this.sessions) this.scheduleResume(session.id);
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
    if (!conversation) return;
    // T3 Code titles a new thread from its first message.
    const saved = this.sessions.some((session) => session.id === conversation?.id);
    if (conversation.empty && !saved) this.title(conversation, text, images);
    // A message replaces going on after a usage limit: the agent's pause ends before it.
    const target = conversation;
    const sessionId = target.id;
    if (sessionId && this.store.thread(sessionId).limit?.resumeAt != null) {
      this.store.setThread(sessionId, { limit: undefined });
      this.scheduleResume(sessionId);
      if (target.session.sessionId) {
        void this.quota(target, null)
          .catch((error: unknown) => this.log.warn(`threads: [${target.tag}] its pause did not end: ${errorText(error)}`))
          .finally(() => target.chat.send(text, images, undefined, now));
        return;
      }
    }
    conversation.chat.send(text, images, undefined, now);
  }

  /** The usage limit `id`'s last turn stopped on, as its agent tells; with `resumeAt`, the time it goes on at (or not) first. */
  private quota(conversation: Conversation, resumeAt?: number | null): Promise<QuotaAnswer> {
    const sessionId = conversation.session.sessionId;
    if (!sessionId) return Promise.reject(new Error("the thread has no session."));
    return conversation.agent.request<QuotaAnswer>(QUOTA, { sessionId, ...(resumeAt === undefined ? {} : { resumeAt }) });
  }

  /**
   * Whether the thread `windowId`, stopped on a usage limit, goes on by itself once the limit
   * resets (T3 Code's "Resume at reset" and "Cancel auto-resume"); why not, when it cannot.
   */
  async resumeAfterLimit(windowId: string, resume: boolean): Promise<string | undefined> {
    const id = this.resolve(windowId);
    const limit = this.store.thread(id).limit;
    if (!limit) return "The thread is not stopped on a usage limit.";
    if (resume && limit.resetAt === null) return "The provider did not say when the limit resets.";
    const resumeAt = resume && limit.resetAt !== null ? Math.max(Date.now(), limit.resetAt + RESUME_GRACE_MS) : null;
    const conversation = this.open.find((open) => open.id === id);
    if (conversation?.session.sessionId) {
      try {
        const answer = await this.quota(conversation, resumeAt);
        this.store.setThread(id, { limit: { resetAt: answer.resetAt ?? limit.resetAt, resumeAt: answer.resumeAt } });
      } catch (error) {
        return errorText(error);
      }
    } else {
      // Its agent starts on it at that time (scheduleResume), or sets it once open (rearm).
      this.store.setThread(id, { limit: { ...limit, resumeAt } });
      if (conversation) this.rearm(conversation, id);
    }
    this.log.info(`threads: ${id} ${resumeAt === null ? "no longer goes on after its usage limit" : `goes on at ${new Date(resumeAt).toISOString()}`}`);
    this.scheduleResume(id);
    this.emit();
    return undefined;
  }

  /** A closed thread that goes on after its usage limit: its agent starts on it then. */
  private scheduleResume(id: string): void {
    clearTimeout(this.resumeTimers.get(id));
    this.resumeTimers.delete(id);
    const limit = this.store.thread(id).limit;
    if (limit?.resumeAt == null || this.open.some((open) => open.id === id)) return;
    if (Date.now() - limit.resumeAt > MAX_OVERDUE_RESUME_MS) {
      this.store.setThread(id, { limit: { ...limit, resumeAt: null } });
      return;
    }
    // A timer waits 2^31-1 ms at most: a later time is looked at again then.
    const wait = Math.min(Math.max(0, limit.resumeAt - Date.now()), 2 ** 31 - 1);
    this.resumeTimers.set(id, setTimeout(() => void this.resumeClosed(id), wait));
  }

  private async resumeClosed(id: string): Promise<void> {
    this.resumeTimers.delete(id);
    const resumeAt = this.store.thread(id).limit?.resumeAt;
    if (resumeAt == null || this.open.some((open) => open.id === id)) return;
    if (resumeAt > Date.now()) return this.scheduleResume(id);
    const summary = this.sessions.find((session) => session.id === id);
    if (!summary) return;
    this.log.info(`threads: ${id} goes on after its usage limit`);
    const saved = { id, path: summary.path };
    const conversation = this.create(saved, summary.cwd || this.home);
    conversation.chat.reset(true);
    conversation.agent.start(saved);
    this.rearm(conversation, id);
  }

  /** An agent started on a thread that goes on after its usage limit: its pause is set again (the last agent's ended with it). */
  private rearm(conversation: Conversation, id: string): void {
    if (this.store.thread(id).limit?.resumeAt == null) return;
    void this.opened(conversation)
      .then(() => {
        const resumeAt = this.store.thread(id).limit?.resumeAt;
        return resumeAt == null ? undefined : this.quota(conversation, Math.max(Date.now(), resumeAt));
      })
      .catch((error: unknown) => this.log.warn(`threads: [${conversation.tag}] its pause was not set again: ${errorText(error)}`));
  }

  /** A title for the new thread `conversation` (titles.ts); a rename made meanwhile is kept. */
  private title(conversation: Conversation, text: string, images: Attachment[]): void {
    const settings = this.store.serverSettings ?? {};
    const instructions = typeof settings.threadTitleInstructions === "string" ? settings.threadTitleInstructions : "";
    const model = (settings.textGenerationModelSelection ?? null) as TitleModel | null;
    void this.ready(conversation)
      .then(() =>
        generateThreadTitle((method, params) => conversation.agent.request(method, params), {
          message: text,
          images,
          instructions,
          model,
        }),
      )
      .then(
        (title) => {
          if (!title) return;
          this.log.info(`threads: [${conversation.tag}] titled "${title}"`);
          this.titled.set(conversation, title);
          this.applyTitle(conversation);
        },
        (error: unknown) => this.log.warn(`threads: [${conversation.tag}] no title: ${errorText(error)}`),
      );
  }

  /** The generated title, once the thread's session has an id, unless the thread has a title already. */
  private applyTitle(conversation: Conversation): void {
    const title = this.titled.get(conversation);
    const { id } = conversation;
    if (!title || !id) return;
    this.titled.delete(conversation);
    if (this.store.thread(id).title !== undefined) return;
    this.store.setThread(id, { title });
    this.emit();
  }

  /** The session of `conversation` is open. */
  private opened(conversation: Conversation): Promise<void> {
    if (conversation.session.sessionId) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const listening = conversation.session.onChange(() => {
        if (conversation.session.sessionId) {
          listening.dispose();
          resolve();
        } else if (conversation.agent.current.kind === "failed") {
          listening.dispose();
          reject(new Error("the agent did not start"));
        }
      });
    });
  }

  /** The agent of `conversation` answers requests. */
  private ready(conversation: Conversation): Promise<void> {
    if (conversation.agent.current.kind === "ready") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const listening = conversation.agent.onChange((state) => {
        if (state.kind === "ready") {
          listening.dispose();
          resolve();
        } else if (state.kind === "failed") {
          listening.dispose();
          reject(new Error("the agent did not start"));
        }
      });
    });
  }

  /** The thread `id` back to before its turn `turn`'s prompt; why not, when it cannot. */
  async rewind(id: string, turn: number): Promise<string | undefined> {
    const conversation = this.openByWindowId(id);
    if (!conversation) return "the thread is not open.";
    return conversation.chat.rewindTo(turn);
  }

  /** The thread `id`'s waiting message `message` changed; false when it no longer waits. */
  changeWaiting(id: string, message: number, text: string, keep: number[], images: Attachment[]): boolean {
    return this.openByWindowId(id)?.chat.changeWaiting(message, text, keep, images) ?? false;
  }

  /** Its waiting message `message` held while it is changed elsewhere, or let go. */
  holdWaiting(id: string, message: number, hold: boolean): void {
    const chat = this.openByWindowId(id)?.chat;
    if (hold) chat?.edit(message);
    else chat?.release(message);
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
      // Any running agent deletes it; else the one on screen once it started (a new thread
      // that took its place may still be starting).
      const running = [this.shownOne, ...this.open].find((open) => open?.agent.current.kind === "ready");
      const agent = running ? running.agent : await this.ready(this.shown).then(() => this.shown.agent);
      await agent.request(DELETE, { sessionId: id });
      this.log.info(`threads: ${id} deleted`);
      this.store.forgetThread(id);
      await this.refresh();
      return undefined;
    } catch (error) {
      const text = errorText(error);
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

  /** Resolves a folder's git repository; set once T3 Code's pull request service runs. */
  resolveRepository?: (cwd: string) => Promise<object | null>;
  private repositories = new Map<string, object | null>();
  private resolvingRepositories = new Set<string>();

  /** The folder's repository when known; else it is looked up, and the app sent again after. */
  private repositoryIdentityOf(path: string): object | null {
    const known = this.repositories.get(path);
    if (known !== undefined || !this.resolveRepository || this.resolvingRepositories.has(path)) return known ?? null;
    this.resolvingRepositories.add(path);
    void this.resolveRepository(path)
      .catch((error: unknown) => {
        this.log.warn(`threads: no repository for ${path}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      })
      .then((identity) => {
        this.repositories.set(path, identity);
        this.resolvingRepositories.delete(path);
        if (identity) this.emit();
      });
    return null;
  }

  /** A pull request linked to the thread `windowId` by its URL; why not, when it cannot be. */
  async linkPullRequest(windowId: string, url: string): Promise<string | undefined> {
    const id = this.resolve(windowId);
    const meta = this.store.thread(id);
    if (meta.links?.some((link) => samePullRequestUrl(link.url, url))) return undefined;
    if (meta.pr && samePullRequestUrl(meta.pr.url, url)) {
      this.store.setThread(id, { unlinkedPr: undefined });
      this.emit();
      return undefined;
    }
    const cwd = this.sessions.find((session) => session.id === id)?.cwd;
    const found = await this.git.pullRequestAt(cwd && existsSync(cwd) ? cwd : this.home, url);
    if (typeof found === "string") return found;
    this.store.setThread(id, { links: [...(this.store.thread(id).links ?? []), { ...found, linkedAt: Date.now() }] });
    this.log.info(`threads: ${id} linked to ${found.url}`);
    this.emit();
    return undefined;
  }

  /** The pull request at `url` no longer shown on the thread: a linked one, or its branch's. */
  unlinkPullRequest(windowId: string, url: string): void {
    const id = this.resolve(windowId);
    const meta = this.store.thread(id);
    const links = meta.links?.filter((link) => !samePullRequestUrl(link.url, url));
    this.store.setThread(id, {
      links: links?.length ? links : undefined,
      ...(meta.pr && samePullRequestUrl(meta.pr.url, url) ? { unlinkedPr: meta.pr.url } : {}),
    });
    this.log.info(`threads: ${id} unlinked from ${url}`);
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
    ).map((project) => {
      const identity = this.repositoryIdentityOf(project.path);
      return identity ? { ...project, repositoryIdentity: identity } : project;
    });
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
        limit: working ? undefined : meta.limit,
        seenAt: meta.seenAt,
      };
      if (working) row.mark = "working";
      else if (unread) row.mark = "unread";
      if (meta.pr && !samePullRequestUrl(meta.pr.url, meta.unlinkedPr)) row.pr = meta.pr;
      if (meta.links?.length) row.links = meta.links;
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
    if (saved) {
      clearTimeout(this.resumeTimers.get(saved.id));
      this.resumeTimers.delete(saved.id);
      this.rearm(conversation, saved.id);
    }
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
    if (id && this.titled.has(conversation)) this.applyTitle(conversation);
    if (alias && id) {
      this.store.setThread(id, { alias });
      this.aliases.delete(conversation);
      this.emit();
    }
    if (!before && working && id) {
      this.workingSince.set(id, Date.now());
      // The limit the last turn stopped on is behind this one.
      if (this.store.thread(id).limit) this.store.setThread(id, { limit: undefined });
    }
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
    // A turn the agent paused on a usage limit ends without an error: the agent tells.
    void this.quota(conversation).then(
      (answer) => {
        const limit = answer.limited ? { resetAt: answer.resetAt, resumeAt: answer.resumeAt } : undefined;
        if (limit) {
          const resumes = limit.resumeAt === null ? "does not go on by itself" : `goes on at ${new Date(limit.resumeAt).toISOString()}`;
          this.log.info(`threads: [${conversation.tag}] stopped on a usage limit; it ${resumes}`);
        }
        if (limit || this.store.thread(id).limit) {
          this.store.setThread(id, { limit });
          this.emit();
        }
      },
      (error: unknown) => this.log.warn(`threads: [${conversation.tag}] its usage limit was not read: ${errorText(error)}`),
    );
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
    if (id) this.scheduleResume(id);
    this.emit();
  }
}

/** The same pull request: GitHub's URLs differ in case and in a trailing part (`/files`...). */
function samePullRequestUrl(left: string, right: string | undefined): boolean {
  const key = (url: string) => /^https?:\/\/([^/]+\/[^/]+\/[^/]+\/pull\/\d+)/i.exec(url)?.[1]?.toLowerCase() ?? url.toLowerCase();
  return right !== undefined && key(left) === key(right);
}
