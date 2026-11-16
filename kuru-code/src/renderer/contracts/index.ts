// The data shapes the T3 Code interface reads, for the Unharnessed agent.
// T3 Code's contracts are Effect schemas of its own server; kuru code has no
// such server, so each shape here is the part its screens read, filled by
// kuru code's main process from Unharnessed (sessions, ACP, git, gh).

import { EnvironmentId, ProjectId, ThreadId } from "./baseSchemas";

/** kuru code runs on one machine: every thread and project is in this environment. */
export const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("local");

export interface ScopedThreadRef {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}
export interface ScopedProjectRef {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

export * from "./baseSchemas";
export * from "./keybindings";
export * from "./settings";
export * from "./providerInstance";
export * from "./vcs";
export * from "./git";
export * from "./sourceControl";

/** A thread the sidebar lists: a top-level one (Unharnessed has no subagent or side-chat threads). */
export function isListedThreadLineage(lineage: { readonly relationshipToParent: string | null }): boolean {
  return lineage.relationshipToParent === null;
}

/** A native context menu's entry, from T3 Code's ipc.ts (kuru code shows them with Electron's Menu). */
export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  detail?: string;
  destructive?: boolean;
  disabled?: boolean;
  header?: boolean;
  icon?: string;
  separatorBefore?: boolean;
  checked?: boolean;
  children?: readonly ContextMenuItem<T>[];
}

/** From T3 Code's orchestrationV2.ts: when a thread was opened, for search ranking. */
export interface OrchestrationV2ThreadOpens {
  readonly openedAt: number;
  readonly score: number;
  readonly picks: ReadonlyArray<{ readonly query: string; readonly at: number }>;
}

/** From T3 Code's ipc.ts: what the window asks of its host. */
export type ConfirmDialogVariant = "default" | "destructive";
export interface ConfirmDialogOptions {
  readonly variant?: ConfirmDialogVariant;
}
export interface LocalApi {
  dialogs: {
    pickFolder: (options?: { readonly initialPath?: string | null }) => Promise<string | null>;
    confirm: (message: string, options?: ConfirmDialogOptions) => Promise<boolean>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
    close: () => Promise<void>;
  };
  persistence: {
    getClientSettings: () => Promise<import("./settings").ClientSettings | null>;
    setClientSettings: (settings: import("./settings").ClientSettings) => Promise<void>;
  };
}

/** The kind of machine an environment runs on; kuru code's one environment is this computer. */
export type EnvironmentMachineKind =
  | "server"
  | "cloud"
  | "linux"
  | "desktop"
  | "laptop"
  | "mac-mini"
  | "mac-studio";

export type ProjectIconColor =
  | "gray"
  | "red"
  | "orange"
  | "amber"
  | "yellow"
  | "lime"
  | "green"
  | "emerald"
  | "teal"
  | "cyan"
  | "sky"
  | "blue"
  | "indigo"
  | "violet"
  | "purple"
  | "fuchsia"
  | "pink"
  | "rose";

/** From T3 Code's contracts/environment.ts: the repository a project's folder is a checkout of. */
export interface RepositoryIdentity {
  readonly canonicalKey: string;
  readonly locator: { readonly source: "git-remote"; readonly remoteName: string; readonly remoteUrl: string };
  readonly webUrl?: string;
  readonly rootPath?: string;
  readonly displayName?: string;
  readonly provider?: string;
  readonly owner?: string;
  readonly name?: string;
  readonly origin?: { readonly canonicalKey: string; readonly remoteUrl?: string; readonly displayName?: string };
}

export function repositoryGroupingKeyOf(identity: RepositoryIdentity): string {
  return identity.origin?.canonicalKey ?? identity.canonicalKey;
}

export function repositoryGroupingDisplayNameOf(identity: RepositoryIdentity): string | undefined {
  return identity.origin
    ? (identity.origin.displayName ?? identity.origin.canonicalKey)
    : identity.displayName;
}

export * from "./pullRequest";
export * from "./threadSearch";
export * from "./chatAttachment";
export * from "./projectScript";
export * from "./threadPullRequest";
export * from "./filesystem";
