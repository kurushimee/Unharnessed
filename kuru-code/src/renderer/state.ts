import { create } from "zustand";
import type {
  AgentState,
  AppPrefs,
  AppState,
  Attachment,
  ChatEntry,
  ChatPatch,
  ChatState,
  HostMessage,
  KernelState,
  LoginState,
  Provider,
  SessionState,
  SettingsState,
  TurnItem,
  VariablePreview,
} from "@shared/protocol";
import { DEFAULT_PREFS } from "@shared/protocol";
import { onHostMessage, post } from "./bridge";

export type Draft = { text: string; images: Attachment[] };
export type ProviderResult = Extract<HostMessage, { type: "providerResult" }>;
export type SettingResult = Extract<HostMessage, { type: "settingResult" }>;
export type LocalScan = Extract<HostMessage, { type: "localScan" }>;
export type LocalProbe = Extract<HostMessage, { type: "localProbe" }>;
export type ToolPart = Extract<HostMessage, { type: "toolPart" }>;

export type SettingsSection = "general" | "providers" | "agent" | "mcp" | "skills" | "instructions" | "about";
/** What the main area shows: the thread, or the Pull requests page. */
export type MainView = { kind: "thread" } | { kind: "prs"; selected?: { repo: string; number: number } };

export const EMPTY_CHAT: ChatState = {
  entries: [],
  busy: false,
  queue: [],
  paused: false,
  commands: [],
  usage: null,
  goal: null,
};

export type Store = {
  agent: AgentState | null;
  providers: Provider[] | null;
  login: LoginState | null;
  session: SessionState | null;
  settings: SettingsState;
  chat: ChatState;
  kernel: KernelState;
  app: AppState | null;
  prefs: AppPrefs;
  /** The `@` menu's files of the thread's folder; `null` until asked. */
  files: string[] | null;
  draft: Draft;
  /** A sent prompt being changed in the composer, or a waiting message, and the draft it pushed out. */
  editing: { id: number; saved: Draft; queued: boolean } | null;
  providerResult: ProviderResult | null;
  settingResult: SettingResult | null;
  localScan: LocalScan | null;
  localProbe: LocalProbe | null;
  kernelTails: Record<string, string | null>;
  kernelPreviews: Record<string, VariablePreview>;
  toolPart: ToolPart | null;
  main: MainView;
  settingsOpen: SettingsSection | null;
  usageOpen: boolean;
  /** Threads that ended in the background, for toasts. */
  done: Extract<HostMessage, { type: "threadDone" }>[];
};

export const useStore = create<Store>(() => ({
  agent: null,
  providers: null,
  login: null,
  session: null,
  settings: { view: null, pending: [], mcp: null, skills: null },
  chat: EMPTY_CHAT,
  kernel: { commands: [], variables: [] },
  app: null,
  prefs: DEFAULT_PREFS,
  files: null,
  draft: { text: "", images: [] },
  editing: null,
  providerResult: null,
  settingResult: null,
  localScan: null,
  localProbe: null,
  kernelTails: {},
  kernelPreviews: {},
  toolPart: null,
  main: { kind: "thread" },
  settingsOpen: null,
  usageOpen: false,
  done: [],
}));

export const set = useStore.setState;
export const get = useStore.getState;

/** What changed, onto the conversation; what did not change keeps its identity (and its render). */
export function applyPatch(chat: ChatState, patch: ChatPatch): ChatState {
  let entries = chat.entries;
  if (patch.heads.length > 0 || patch.items.length > 0) {
    entries = [...entries];
    const index = new Map(entries.map((entry, at) => [entry.id, at]));
    for (const head of patch.heads) {
      const at = index.get(head.id);
      const before = at === undefined ? undefined : entries[at];
      const entry: ChatEntry = head.kind === "turn" ? { ...head, items: before?.kind === "turn" ? before.items : [] } : head;
      if (at === undefined) index.set(head.id, entries.push(entry) - 1);
      else entries[at] = entry;
    }
    const byEntry = new Map<number, [number, TurnItem][]>();
    for (const [id, at, item] of patch.items) byEntry.set(id, [...(byEntry.get(id) ?? []), [at, item]]);
    for (const [id, changes] of byEntry) {
      const at = index.get(id);
      const entry = at === undefined ? undefined : entries[at];
      if (at === undefined || entry?.kind !== "turn") continue;
      const items = [...entry.items];
      for (const [itemAt, item] of changes) items[itemAt] = item;
      entries[at] = { ...entry, items };
    }
  }
  return {
    entries,
    busy: patch.busy,
    queue: patch.queue,
    paused: patch.paused,
    commands: patch.commands ?? chat.commands,
    usage: patch.usage === undefined ? chat.usage : patch.usage,
    goal: patch.goal === undefined ? chat.goal : patch.goal,
  };
}

/** Listens to the main process for the window's whole life. */
export function connect(): void {
  onHostMessage((message) => {
    switch (message.type) {
      case "init":
        set({
          agent: message.agent,
          providers: message.providers,
          login: message.login,
          session: message.session,
          settings: message.settings,
          chat: message.chat,
          kernel: message.kernel,
        });
        break;
      case "conversation":
        set({
          agent: message.agent,
          session: message.session,
          chat: message.chat,
          kernel: message.kernel,
          editing: null,
          draft: message.draft,
          files: null,
          kernelTails: {},
          kernelPreviews: {},
          main: { kind: "thread" },
        });
        break;
      case "kernel":
        set({ kernel: message.kernel });
        break;
      case "chat":
        set({ chat: message.chat });
        break;
      case "chatPatch":
        set((state) => ({ chat: applyPatch(state.chat, message.patch) }));
        break;
      case "chatEdit": {
        const { id, text, images, queued } = message;
        const was = get().editing;
        if (was?.queued && was.id !== id) post({ type: "release", id: was.id });
        set({ editing: { id, saved: was?.saved ?? get().draft, queued }, draft: { text, images } });
        break;
      }
      case "agent":
        set({ agent: message.agent });
        break;
      case "session":
        set({ session: message.session });
        break;
      case "providers":
        set({ providers: message.providers, login: message.login });
        break;
      case "providerResult":
        set({ providerResult: message });
        break;
      case "localScan":
        set({ localScan: message });
        break;
      case "localProbe":
        set({ localProbe: message });
        break;
      case "settings":
        set({ settings: message.settings });
        break;
      case "settingResult":
        set({ settingResult: message });
        break;
      case "files":
        set({ files: message.files });
        break;
      case "kernelTail":
        set((state) => ({ kernelTails: { ...state.kernelTails, [message.id]: message.tail } }));
        break;
      case "kernelPreview":
        set((state) => ({ kernelPreviews: { ...state.kernelPreviews, [message.name]: message.preview } }));
        break;
      case "app":
        set({ app: message.app });
        break;
      case "prefs":
        set({ prefs: message.prefs });
        applyTheme(message.prefs.theme);
        break;
      case "threadDone":
        set((state) => ({ done: [...state.done, message] }));
        break;
      case "toolPart":
        set({ toolPart: message });
        break;
      case "history":
      case "droppedImages":
        break;
    }
  });
  post({ type: "ready" });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(get().prefs.theme));
}

export function applyTheme(theme: AppPrefs["theme"]): void {
  localStorage.setItem("kuru:theme", JSON.stringify(theme));
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** The composer's draft, and the end of an edit: the draft it pushed out comes back. */
export function setDraft(draft: Draft): void {
  set({ draft });
}

export function endEdit(): void {
  const { editing } = get();
  if (editing?.queued) post({ type: "release", id: editing.id });
  set({ editing: null, ...(editing ? { draft: editing.saved } : {}) });
}
