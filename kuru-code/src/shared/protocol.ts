// Messages between kuru code's main process and its window. The chat, the
// agent, the settings, the providers and the kernel keep the VS Code
// extension's messages (vscode/src/protocol.ts); the app adds its own:
// projects, threads, git and the pages.
import type {
  Draft,
  HostMessage as PanelHostMessage,
  WebviewMessage as PanelWebviewMessage,
} from "../../../vscode/src/protocol";

export type * from "../../../vscode/src/protocol";

/** A folder threads run in. */
export type Project = {
  /** Its path, lowercased on Windows: two spellings of one folder are one project. */
  id: string;
  path: string;
  name: string;
  /** The folder is gone. */
  missing?: boolean;
  /** When it was pinned, or archived, ms. */
  pinnedAt?: number;
  archivedAt?: number;
  /** Its icon, when set (T3 Code's project icon override), and a chosen favicon file. */
  projectIcon?: ProjectIconOverride;
  faviconPath?: string;
};

/** T3 Code's project icon override: a monogram or an emoji. */
export type ProjectIconOverride =
  | { kind: "monogram"; text: string; color: string }
  | { kind: "emoji"; emoji: string };

/** A pull request a thread's branch has on GitHub. */
export type PullRequestRef = {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
};

/** A thread mark: a turn runs in it, or one ended there and was not seen. */
export type ThreadMark = "working" | "unread";

/** One saved conversation, as the sidebar shows it. */
export type ThreadRow = {
  id: string;
  /** `null`: no project (the home folder). */
  projectId: string | null;
  cwd: string;
  title?: string;
  created: number;
  updated: number;
  branch?: string;
  provider?: string;
  model?: string;
  mark?: ThreadMark;
  settled: boolean;
  pinned: boolean;
  pr?: PullRequestRef;
  /** When it was settled or pinned, ms. */
  settledAt?: number;
  pinnedAt?: number;
  /** Its pinned order among pinned threads (T3 Code's fractional order key), and among active ones. */
  pinOrderKey?: string;
  activeOrderKey?: string;
  /** When it was taken back out of Settled, ms. */
  unsettledAt?: number;
  /** Snoozed until then (ISO time), since `snoozedAt`. */
  snoozedUntil?: string;
  snoozedAt?: string;
  /** Kept out of automatic settling since then, ms. */
  autoSettleDisabledAt?: number;
  /** Archived then, ms. */
  archivedAt?: number;
  /** When its running turn started, ms. */
  workingSince?: number;
  /** When its last turn ended, ms, and whether it failed. */
  turnEndedAt?: number;
  failed?: boolean;
  /** When it was last on screen, ms. */
  seenAt?: number;
};

/** The thread on screen: a saved one, or a new one nothing was asked in yet (a draft). */
export type ShownThread = {
  /** Its session id, once its agent opened it. */
  id?: string;
  cwd: string;
  projectId: string | null;
  draft: boolean;
  /** When a saved thread last changed before it was opened, ms: an old one offers to compact first. */
  idleSince?: number;
};

export type AppState = {
  projects: Project[];
  threads: ThreadRow[];
  shown: ShownThread;
  home: string;
  /** `null` until the first read of the sessions folder. */
  loaded: boolean;
};

/** The app's own preferences (the agent's are its settings file). */
export type AppPrefs = {
  theme: "system" | "light" | "dark";
  /** A notification when a thread ends while the window is not focused. */
  notifications: boolean;
  /** Ask before deleting a thread. */
  confirmDelete: boolean;
  /** Offer to compact an old conversation's context when returning to it. */
  resumeCompaction: boolean;
  /** Threads with a running turn gather in a Working section. */
  workingSection: boolean;
  timestampFormat: "relative" | "24h" | "12h";
};

export const DEFAULT_PREFS: AppPrefs = {
  theme: "system",
  notifications: true,
  confirmDelete: true,
  resumeCompaction: true,
  workingSection: true,
  timestampFormat: "relative",
};

export type HostMessage =
  | PanelHostMessage
  | { type: "app"; app: AppState }
  | { type: "prefs"; prefs: AppPrefs }
  /** A thread ended in the background: the window shows a toast. */
  | { type: "threadDone"; id: string; title?: string; failed: boolean }
  /** The tool's code or output, to show in a viewer. */
  | { type: "toolPart"; id: string; part: "input" | "output"; text: string; python: boolean };

export type WebviewMessage =
  | Exclude<PanelWebviewMessage, { type: "newChat" }>
  /** A new thread: in `projectId` (`null`: no project; absent: the shown thread's project). */
  | { type: "newChat"; draft: Draft; projectId?: string | null }
  | { type: "settle"; id: string; settled: boolean }
  | { type: "pin"; id: string; pinned: boolean }
  | { type: "rename"; id: string; title: string | null }
  | { type: "addProject" }
  | { type: "removeProject"; id: string }
  | { type: "setPrefs"; prefs: Partial<AppPrefs> }
  | { type: "seen"; id: string };
