import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, Notification, screen, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { connectedModels } from "../../../vscode/src/instructions";
import { Providers } from "../../../vscode/src/providers";
import { Settings } from "../../../vscode/src/settings";
import { ShownAgent } from "../../../vscode/src/shown";
import type { Conversation } from "../../../vscode/src/conversations";
import type { AppPrefs, HostMessage, WebviewMessage } from "@shared/protocol";
import { showContextMenu } from "./contextMenu";
import { Git } from "./git";
import { createRpc } from "./rpc";
import { projectFavicon } from "./favicons";
import { searchThreads } from "./search";
import { createLog } from "./log";
import { Limits } from "./limits";
import { projectId, Store, type ProjectChange, type ThreadMeta } from "./store";
import { Threads } from "./threads";
import { usageReport } from "./usage";
import { writeCommitMessage } from "./writer";

// Started from a VS Code terminal or extension, Electron would run as Node.
delete process.env.ELECTRON_RUN_AS_NODE;

const APP_NAME = "kuru code";
app.setName(APP_NAME);
app.setAppUserModelId("dev.kuru.code");
if (process.env.KURU_USER_DATA) app.setPath("userData", process.env.KURU_USER_DATA);

const TITLEBAR_HEIGHT = 40;
const TITLEBAR_COLOR = "#01000000";

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void start();
}

async function start(): Promise<void> {
  await app.whenReady();
  const log = createLog(join(app.getPath("userData"), "logs"));
  const version = app.getVersion();
  const binary = agentBinary();
  log.info(`kuru code ${version} (electron ${process.versions.electron}), agent ${binary}`);
  const home = homedir();
  const store = new Store(app.getPath("userData"));
  const git = new Git(log);
  const shown = new ShownAgent(log);
  // Before the first thread: they listen to every agent's notifications.
  const providers = new Providers(shown, log);
  const settings = new Settings(shown, log);
  const sleepAfter = Number(process.env.KURU_SLEEP_MS) || undefined;
  const threads = new Threads(binary, version, home, shown, store, git, log, sleepAfter);
  const limits = new Limits(log);
  let window: BrowserWindow | undefined;

  /** The window, while it exists: closed by its X, it is destroyed and any call on it throws. */
  const live = () => (window && !window.isDestroyed() ? window : undefined);
  let quitting = false;
  // A main-process error goes to the log: Electron's own dialog would block the app.
  process.on("uncaughtException", (error) => log.error(`uncaught: ${error.stack ?? String(error)}`));
  process.on("unhandledRejection", (reason) => log.error(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`));

  const post = (message: HostMessage) => {
    if (window && !window.isDestroyed()) window.webContents.send("host", message);
  };

  // What a thread sends the window, while it is the one on screen.
  threads.onCreate((conversation: Conversation) => {
    const { agent, session, chat, kernel } = conversation;
    const isShown = () => threads.isShown(conversation);
    agent.onChange((state) => isShown() && post({ type: "agent", agent: state }));
    session.onChange(() => isShown() && post({ type: "session", session: session.current }));
    chat.onPost((message) => isShown() && post(message));
    kernel.onChange(() => isShown() && post({ type: "kernel", kernel: kernel.current }));
  });
  threads.onShow(() => {
    const { agent, session, chat, kernel, draft } = threads.shown;
    post({ type: "conversation", agent: agent.current, session: session.current, chat: chat.current, kernel: kernel.current, draft });
  });
  threads.onApp((state) => post({ type: "app", app: state }));
  threads.onDone(({ id, title, failed, shown: onScreen }) => {
    if (quitting) return;
    const focused = live()?.isFocused() ?? false;
    if (!onScreen) post({ type: "threadDone", id, title, failed });
    if (store.prefs.notifications && (!focused || !onScreen) && Notification.isSupported()) {
      const note = new Notification({
        title: failed ? "Thread failed" : "Thread finished",
        body: title ?? "A thread finished.",
        silent: false,
      });
      note.on("click", () => {
        live()?.show();
        live()?.focus();
        threads.openSaved(id);
      });
      note.show();
    }
  });
  providers.onChange(() => post({ type: "providers", providers: providers.providers, login: providers.signIn }));
  settings.onChange(() => post({ type: "settings", settings: settings.current }));

  const receive = (message: WebviewMessage) => {
    const thread = threads.shown;
    switch (message.type) {
      case "ready":
        log.info("window ready");
        thread.chat.release();
        post({
          type: "init",
          splash: false,
          agent: thread.agent.current,
          providers: providers.providers,
          login: providers.signIn,
          session: thread.session.current,
          settings: settings.current,
          chat: thread.chat.current,
          history: { chats: null, unread: false },
          kernel: thread.kernel.current,
        });
        post({ type: "app", app: threads.app });
        post({ type: "prefs", prefs: store.prefs });
        break;
      case "screen":
        log.info(`window: ${message.screen}`);
        break;
      case "crashed":
        log.error(`window: crashed: ${message.error}`);
        break;
      case "restartAgent":
        log.info("agent restart requested from the window");
        void threads.restart();
        break;
      case "setApiKey": {
        const { providerId } = message;
        void providers.setApiKey(providerId, message.apiKey).then((error) => post({ type: "providerResult", action: "apiKey", providerId, error }));
        break;
      }
      case "logout": {
        const { providerId } = message;
        void providers.logout(providerId).then((error) => post({ type: "providerResult", action: "logout", providerId, error }));
        break;
      }
      case "scanLocal":
        void providers.scanLocal().then((servers) => post({ type: "localScan", servers }));
        break;
      case "probeLocal": {
        const { baseUrl, apiKey } = message;
        void providers.probeLocal(baseUrl, apiKey).then((probe) => post({ type: "localProbe", baseUrl, apiKey, probe }));
        break;
      }
      case "saveLocal": {
        const providerId = message.rowId;
        void providers.saveLocal(message.server).then((error) => post({ type: "providerResult", action: "local", providerId, error }));
        break;
      }
      case "removeLocal": {
        const { providerId } = message;
        void providers.removeLocal(providerId).then((error) => post({ type: "providerResult", action: "local", providerId, error }));
        break;
      }
      case "login": {
        const { providerId } = message;
        if (providerId.startsWith("mcp:")) mcpSignIn(providerId.slice(4), providers.signIn?.name);
        else void providers.startLogin(providerId);
        break;
      }
      case "loginAnswer":
        void providers.answer(message.promptId, message.answer);
        break;
      case "loginOpen":
        void providers.openPage();
        break;
      case "loginCancel":
        providers.cancelLogin();
        break;
      case "loginClose":
        providers.closeLogin();
        break;
      case "setConfig": {
        const { type: _, ...change } = message;
        void thread.session.setOption(change);
        break;
      }
      case "setSetting": {
        const { key } = message;
        void settings.set(key, message.value).then((error) => post({ type: "settingResult", key, error }));
        break;
      }
      case "setInstructions": {
        const session = thread.session.current;
        const choices = session?.kind === "open" ? session.config.model?.choices : undefined;
        const connected = choices ? new Set(connectedModels(choices, providers.providers ?? []).keys()) : null;
        void settings
          .setInstructions(message.index, message.group, connected)
          .then((error) => post({ type: "settingResult", key: "modelInstructions", error }));
        break;
      }
      case "mcpSignIn":
        mcpSignIn(message.id, message.label);
        break;
      case "mcpSetToken": {
        const key = `mcp:${message.id}`;
        void settings.setToken(message.id, message.token).then((error) => post({ type: "settingResult", key, error }));
        break;
      }
      case "mcpSignOut": {
        const key = `mcp:${message.id}`;
        void settings.signOut(message.id).then((error) => post({ type: "settingResult", key, error }));
        break;
      }
      case "setSkill": {
        const key = `skill:${message.path}`;
        void settings.setSkill(message.path, message.enabled).then((error) => post({ type: "settingResult", key, error }));
        break;
      }
      case "createSkill":
        void settings.createSkill(message.name, message.description).then(({ created, error }) => {
          post({ type: "settingResult", key: "skills/create", error });
          if (created) void shell.openPath(created);
        });
        break;
      case "skillFolder":
        void settings.skillFolder(message.path, message.add).then((error) => post({ type: "settingResult", key: "skills/folder", error }));
        break;
      case "openFile":
        // Only a skill on the list: the window never names any other file.
        if (settings.skillFiles.includes(message.path)) void shell.openPath(message.path);
        break;
      case "copy":
        clipboard.writeText(message.text);
        break;
      case "openCell": {
        const found = thread.chat.toolPart(message.id, message.part);
        if (found) post({ type: "toolPart", id: message.id, part: message.part, text: found.text, python: found.python });
        break;
      }
      case "send":
        thread.chat.send(message.text, message.images, message.edit, message.now);
        break;
      case "edit":
        thread.chat.edit(message.id);
        break;
      case "release":
        thread.chat.release(message.id);
        break;
      case "listFiles": {
        void threads.filesOf(thread).list().then(({ files: list, open }) => post({ type: "files", files: list, open }));
        break;
      }
      case "readImages":
        break;
      case "cancel":
        thread.chat.cancel();
        break;
      case "goal":
        if (message.action === "pause") thread.chat.pauseGoal();
        else if (message.action === "resume") thread.chat.resumeGoal();
        else thread.chat.endGoal();
        break;
      case "unqueue":
        thread.chat.unqueue(message.id);
        break;
      case "moveQueued":
        thread.chat.move(message.id, message.to);
        break;
      case "sendNow":
        thread.chat.sendNow(message.id);
        break;
      case "resumeQueue":
        thread.chat.resume();
        break;
      case "newChat": {
        thread.chat.release();
        const projects = threads.app.projects;
        const cwd =
          message.projectId === undefined
            ? threads.cwdOf(thread)
            : message.projectId === null
              ? home
              : (projects.find((project) => project.id === message.projectId)?.path ?? home);
        threads.newChat(cwd, message.draft);
        break;
      }
      case "listChats":
        void threads.refresh();
        break;
      case "openChat":
        if (message.id === thread.id) break;
        thread.chat.release();
        threads.openSaved(message.id, message.draft);
        break;
      case "deleteChat":
        void threads.remove(message.id);
        break;
      case "openLink":
        if (/^https?:\/\//i.test(message.url)) void shell.openExternal(message.url);
        break;
      case "kernelTail": {
        const { id } = message;
        void thread.kernel.tail(id).then((tail) => post({ type: "kernelTail", id, tail }));
        break;
      }
      case "kernelKill":
        void thread.kernel.kill(message.id);
        break;
      case "kernelDismiss":
        thread.kernel.dismiss(message.id);
        break;
      case "kernelPreview": {
        const { name } = message;
        void thread.kernel.preview(name).then((preview) => post({ type: "kernelPreview", name, preview }));
        break;
      }
      case "settle":
        threads.setMeta(message.id, { settledAt: message.settled ? Date.now() : undefined });
        break;
      case "pin":
        threads.setMeta(message.id, { pinnedAt: message.pinned ? Date.now() : undefined });
        break;
      case "rename":
        threads.setMeta(message.id, { title: message.title?.trim() || undefined });
        break;
      case "addProject":
        void addProject();
        break;
      case "removeProject":
        store.removeProject(message.id);
        threads.emit();
        break;
      case "setPrefs":
        store.setPrefs(message.prefs);
        applyTheme(store.prefs);
        post({ type: "prefs", prefs: store.prefs });
        break;
      case "seen":
        threads.seen(message.id);
        break;
    }
  };

  const mcpSignIn = (id: string, label: string | undefined) => {
    void providers.startLogin(`mcp:${id}`, label).then((done) => {
      if (done) settings.signedIn(id);
    });
  };

  const addProject = async () => {
    const owner = live();
    if (!owner) return;
    const picked = await dialog.showOpenDialog(owner, { title: "Add project", properties: ["openDirectory", "createDirectory"] });
    const path = picked.filePaths[0];
    if (picked.canceled || !path) return;
    const id = store.addProject(path);
    log.info(`projects: added ${path}`);
    threads.emit();
    receive({ type: "newChat", draft: { text: "", images: [] }, projectId: id });
  };

  const applyTheme = (prefs: AppPrefs) => {
    nativeTheme.themeSource = prefs.theme;
    if (window && !window.isDestroyed()) {
      window.setTitleBarOverlay({
        color: TITLEBAR_COLOR,
        height: TITLEBAR_HEIGHT,
        symbolColor: nativeTheme.shouldUseDarkColors ? "#f8fafc" : "#1f2937",
      });
    }
  };
  nativeTheme.on("updated", () => applyTheme(store.prefs));

  ipcMain.on("webview", (_event, message: WebviewMessage) => {
    try {
      receive(message);
    } catch (error) {
      log.error(error instanceof Error ? error : String(error));
    }
  });

  const handlers: Record<string, (params: any) => unknown> = {
    "git.status": ({ cwd }) => git.status(cwd),
    "git.branches": ({ cwd }) => git.branches(cwd),
    "git.checkout": async ({ cwd, branch, create }) => {
      const error = await git.checkout(cwd, branch, create);
      void threads.refresh();
      return error ?? null;
    },
    "git.branch": ({ cwd }) => git.branch(String(cwd)).then((name) => name ?? null),
    "git.init": ({ cwd }) => git.init(cwd).then((error) => error ?? null),
    "git.act": (request) => git.act(request, (cwd) => writeCommitMessage(binary, cwd, log)),
    "git.changedFiles": ({ cwd, against }) => git.changedFiles(cwd, against),
    "git.diff": ({ cwd, against, path }) => git.diff(cwd, against, path),
    "prs.list": ({ state }) => git.pullRequests(threads.app.projects.filter((project) => !project.missing).map((project) => project.path), state),
    "prs.get": ({ repo, number }) => git.pullRequest(repo, number),
    "prs.diff": ({ repo, number }) => git.pullRequestDiff(repo, number),
    "prs.comment": ({ repo, number, body }) => git.comment(repo, number, body).then((error) => error ?? null),
    "prs.checkout": async ({ repo, number }) => {
      for (const project of threads.app.projects) {
        if ((await git.githubAll(project.path)).some((found) => found.toLowerCase() === String(repo).toLowerCase())) {
          const error = await git.checkoutPullRequest(project.path, number, String(repo));
          return error ? { error } : { cwd: project.path, projectId: project.id };
        }
      }
      return { error: `No project here is a clone of ${repo}.` };
    },
    "prs.repoProject": async ({ repo }) => {
      for (const project of threads.app.projects) {
        if ((await git.githubAll(project.path)).some((found) => found.toLowerCase() === String(repo).toLowerCase())) return project.id;
      }
      return null;
    },
    "usage.get": ({ days }) => usageReport(days),
    "limits.get": () => limits.read(),
    "shell.openExternal": ({ url }) => (/^https?:\/\//i.test(url) ? shell.openExternal(url) : undefined),
    "shell.openPath": ({ path }) => shell.openPath(path),
    "shell.showItemInFolder": ({ path }) => shell.showItemInFolder(path),
    "open.in": ({ path, target }) => openIn(String(path), String(target)),
    "app.info": () => ({ version, electron: process.versions.electron, binary, log: log.file, userData: app.getPath("userData") }),
    "projects.add": ({ path }) => {
      const folder = String(path);
      if (!existsSync(folder)) return null;
      const id = store.addProject(folder);
      log.info(`projects: added ${folder}`);
      threads.emit();
      receive({ type: "newChat", draft: { text: "", images: [] }, projectId: id });
      return id;
    },
    "app.projectId": ({ path }) => projectId(path),
    "projects.update": ({ id, change }) => {
      const project = threads.app.projects.find((candidate) => candidate.id === id);
      if (!project) return "That project is gone.";
      store.updateProject(project.id, project.path, change as ProjectChange);
      threads.emit();
      return null;
    },
    "threads.search": ({ query, projectIds }) => {
      const scope = Array.isArray(projectIds) ? new Set(projectIds.map(String)) : null;
      return searchThreads(
        String(query),
        threads.searchable.filter((session) => scope === null || (session.projectId !== null && scope.has(session.projectId))),
      );
    },
    "threads.send": ({ id, projectId: project, text, images, now }) => {
      const cwd =
        typeof project === "string"
          ? (threads.app.projects.find((candidate) => candidate.id === project)?.path ?? home)
          : home;
      threads.send(String(id), cwd, String(text ?? ""), Array.isArray(images) ? images : [], now === true);
      return null;
    },
    "threads.cancel": ({ id }) => {
      threads.cancel(String(id));
      return null;
    },
    "threads.open": ({ id }) => {
      if (threads.app.shown.id !== id) threads.openSaved(String(id));
      return null;
    },
    "threads.delete": ({ id }) => threads.remove(String(id)).then((error) => error ?? null),
    "threads.update": ({ id, change }) => {
      threads.setMeta(String(id), threadMetaChange(change));
      return null;
    },
    "project.favicon": ({ cwd }) => projectFavicon(String(cwd)),
    "clientSettings.get": () => store.clientSettings,
    "serverSettings.get": () => store.serverSettings,
    "serverSettings.set": ({ settings }) => {
      store.setServerSettings(settings);
      return null;
    },
    "clientSettings.set": ({ settings }) => {
      store.setClientSettings(settings);
      return null;
    },
    "contextMenu.show": ({ items, position }) => {
      const shown = live();
      return shown ? showContextMenu(shown, items, position) : null;
    },
    "dialogs.pickFolder": async () => {
      const owner = live();
      if (!owner) return null;
      const picked = await dialog.showOpenDialog(owner, { title: "Add project", properties: ["openDirectory", "createDirectory"] });
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
  };
  const rpc = createRpc({ git, log, writeMessage: (cwd) => writeCommitMessage(binary, cwd, log), changed: () => void threads.refresh() });
  ipcMain.handle("rpc", (_event, tag: string, payload: unknown) => rpc.call(tag, payload));
  ipcMain.handle("rpc-subscribe", (event, id: string, tag: string, payload: unknown) => rpc.subscribe(event.sender, id, tag, payload));
  ipcMain.on("rpc-unsubscribe", (_event, id: string) => rpc.unsubscribe(id));

  ipcMain.handle("invoke", async (_event, method: string, params: unknown) => {
    const handler = handlers[method];
    if (!handler) throw new Error(`no method ${method}`);
    try {
      return await handler(params ?? {});
    } catch (error) {
      log.warn(`invoke ${method} failed: ${String(error)}`);
      throw error;
    }
  });

  const createWindow = () => {
    nativeTheme.themeSource = store.prefs.theme;
    const saved = store.window;
    const bounds = saved && screen.getAllDisplays().some((display) => inside(display.workArea, saved)) ? saved : { width: 1280, height: 860 };
    window = new BrowserWindow({
      ...bounds,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: APP_NAME,
      icon: iconPath(),
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
      titleBarStyle: "hidden",
      titleBarOverlay: { color: TITLEBAR_COLOR, height: TITLEBAR_HEIGHT, symbolColor: nativeTheme.shouldUseDarkColors ? "#f8fafc" : "#1f2937" },
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: true,
      },
    });
    if (saved?.maximized) window.maximize();
    window.once("ready-to-show", () => window?.show());
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== window?.webContents.getURL()) {
        event.preventDefault();
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      }
    });
    const remember = () => {
      if (!window || window.isDestroyed()) return;
      const maximized = window.isMaximized();
      const box = maximized ? (store.window ?? window.getNormalBounds()) : window.getBounds();
      store.setWindow({ x: box.x, y: box.y, width: box.width, height: box.height, maximized });
    };
    window.on("resize", remember);
    window.on("move", remember);
    window.on("focus", () => {
      const id = threads.shown.id;
      if (id) threads.seen(id);
    });
    const devUrl = process.env.KURU_DEV_URL;
    if (devUrl) void window.loadURL(devUrl);
    else void window.loadFile(join(__dirname, "..", "renderer", "index.html"));
  };

  app.on("second-instance", () => {
    const shown = live();
    if (!shown) return;
    if (shown.isMinimized()) shown.restore();
    shown.focus();
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    log.info("quitting: the agents stop, each saving its kernel");
    // Closed by its X, the window is already destroyed.
    if (window && !window.isDestroyed()) window.hide();
    try {
      store.flush();
    } catch (error) {
      log.error(`store: not saved on quit: ${String(error)}`);
    }
    // Each agent is killed past its own wait (40 s); the app goes a little after, whatever happens.
    const deadline = setTimeout(() => app.exit(0), 45_000);
    void threads.stopAll().finally(() => {
      clearTimeout(deadline);
      log.info("quitting: every agent stopped");
      app.exit(0);
    });
  });
  app.on("window-all-closed", () => app.quit());

  const startCwd = lastProject(store, threads, home);
  void threads.start(startCwd);
  createWindow();
}

/** The agent: next to the app when installed, else the repository's build. */
function agentBinary(): string {
  if (process.env.UNHARNESSED_BIN) return process.env.UNHARNESSED_BIN;
  const name = process.platform === "win32" ? "unharnessed.exe" : "unharnessed";
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "bin", name)]
    : [resolve(__dirname, "..", "..", "..", "target", "release", name), resolve(__dirname, "..", "..", "..", "target", "debug", name)];
  return candidates.find((path) => existsSync(path)) ?? name;
}

function iconPath(): string | undefined {
  const path = app.isPackaged ? join(process.resourcesPath, "icon.ico") : resolve(__dirname, "..", "..", "resources", "icon.ico");
  return existsSync(path) ? path : undefined;
}

/** The first thread's folder: the last one a thread started in, while it exists; else the home folder. */
function lastProject(store: Store, _threads: Threads, home: string): string {
  const last = store.lastCwd;
  return last && existsSync(last) ? last : home;
}

function inside(area: Electron.Rectangle, box: { x?: number; y?: number; width: number; height: number }): boolean {
  if (box.x === undefined || box.y === undefined) return true;
  return box.x < area.x + area.width && box.x + box.width > area.x && box.y < area.y + area.height && box.y + box.height > area.y;
}

/** A folder in Explorer, an editor or a terminal. */
async function openIn(path: string, target: string): Promise<string | null> {
  if (!existsSync(path)) return `${path} does not exist.`;
  if (target === "explorer") {
    const error = await shell.openPath(path);
    return error || null;
  }
  const commands: Record<string, string> = {
    vscode: `code "${path}"`,
    cursor: `cursor "${path}"`,
    terminal: `where wt >nul 2>nul && (wt -d "${path}") || (start "" /D "${path}" cmd)`,
  };
  const command = commands[target];
  if (!command) return `Unknown target ${target}.`;
  return new Promise((resolveOpen) => {
    const child = spawn("cmd.exe", ["/d", "/s", "/c", `"${command}"`], { cwd: path, detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true });
    child.on("error", (error) => resolveOpen(String(error)));
    child.on("spawn", () => {
      child.unref();
      resolveOpen(null);
    });
  });
}

/** The sidebar state the window may set on a thread; `null` clears a field. */
function threadMetaChange(change: unknown): Partial<ThreadMeta> {
  const keys = [
    "settledAt",
    "pinnedAt",
    "unsettledAt",
    "pinOrderKey",
    "activeOrderKey",
    "snoozedUntil",
    "snoozedAt",
    "autoSettleDisabledAt",
    "archivedAt",
    "unread",
    "title",
  ] as const;
  const next: Partial<ThreadMeta> = {};
  const given = (change ?? {}) as Record<string, unknown>;
  for (const key of keys) {
    if (!(key in given)) continue;
    const value = given[key];
    (next as Record<string, unknown>)[key] = value === null ? undefined : value;
  }
  return next;
}
