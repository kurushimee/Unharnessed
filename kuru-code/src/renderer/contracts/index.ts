// T3 Code's contracts (packages/contracts), the schemas its interface reads.
// Most files are T3 Code's own; kuru code's main process fills them from
// Unharnessed (sessions, ACP, git, gh). ipc.ts's window API is kept here.

import { EnvironmentId } from "./baseSchemas";

/** kuru code runs on one machine: every thread and project is in this environment. */
export const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("local");

export * from "./baseSchemas";
export * from "./keybindings";
export * from "./settings";
export * from "./providerInstance";
export * from "./vcs";
export * from "./git";
export * from "./sourceControl";
export * from "./pullRequest";
export * from "./threadSearch";
export * from "./chatAttachment";
export * from "./threadPullRequest";
export * from "./filesystem";
export * from "./auth";
export * from "./checkpointDiff";
export * from "./composerContext";
export * from "./environment";
export * from "./guestShare";
export * from "./model";
export * from "./modelSelection";
export * from "./orchestrationProject";
export * from "./orchestrationV2";
export * from "./orchestrationV2IdTable";
export * from "./project";
export * from "./providerPolicy";
export * from "./providerRuntime";
export * from "./secretReference";
export * from "./threadTags";

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

export * from "./acpRegistry";
export * from "./assets";
export * from "./assistantCitations";
export * from "./browserImport";
export * from "./browserProfile";
export * from "./desktopAppActivation";
export * from "./device";
export * from "./editor";
export * from "./ipc";
export * from "./managedPolicy";
export * from "./preview";
export * from "./previewCapture";
export * from "./providerUsageLimits";
export * from "./remoteAccess";
export * from "./server";
export * from "./settingsSecretValue";
export * from "./speech";
export * from "./usage";
export * from "./usageLimitSourceId";
export * from "./worktreeSetup";
export * from "./agentSessions";
export * from "./background";
export * from "./clientRpcPermissions";
export * from "./composerContextClipboard";
export * from "./environmentHttp";
export * from "./mcpApps";
export * from "./orchestrationDispatch";
export * from "./peerLink";
export * from "./projectClone";
export * from "./provider";
export * from "./providerSetup";
export * from "./pullRequestReviewGuide";
export * from "./relay";
export * from "./relayClient";
export * from "./resourceTelemetry";
export * from "./review";
export * from "./rpc";
export * from "./scheduledTask";
export * from "./secretRequest";
export * from "./terminal";
export * from "./t3ProjectFile";
