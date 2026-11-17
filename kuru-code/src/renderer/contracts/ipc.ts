import * as Schema from "effect/Schema";

import { SnapShotSource } from "./chatAttachment";
import { TrimmedNonEmptyString } from "./baseSchemas";
import { AuthAccessTokenResult, AuthSessionState } from "./auth";
import { AdvertisedEndpoint } from "./remoteAccess";
import { ExecutionEnvironmentDescriptor } from "./environment";
import { type ClientSettings, type QuitConfirmationMode, SnapShotShortcut } from "./settings";
import type { EditorId } from "./editor";

import type { DesktopAppActivationRequest, DesktopAppActivationResponse } from "./desktopAppActivation";

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

export type QuitShortcutHintEvent =
  | { readonly state: "down"; readonly mode: Exclude<QuitConfirmationMode, "direct"> }
  | { readonly state: "up" };

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme = "light" | "dark" | "system";
export type DesktopUpdateChannel = "latest" | "nightly";
export type DesktopAppStageLabel = "Alpha" | "Beta" | "Dev" | "Nightly";

export interface DesktopAppBranding {
  baseName: string;
  stageLabel: DesktopAppStageLabel;
  displayName: string;
}

export const DesktopSnapShotMode = Schema.Literals(["direct", "portal", "unavailable"]);
export type DesktopSnapShotMode = typeof DesktopSnapShotMode.Type;

export const DesktopCaptureExtensionState = Schema.Struct({
  status: Schema.Literals([
    "not-installed",
    "disabled",
    "enabled",
    "restart-required",
    "update-required",
    "extensions-disabled",
    "unsupported",
    "error",
  ]),
  message: Schema.String,
});
export type DesktopCaptureExtensionState = typeof DesktopCaptureExtensionState.Type;

export const DesktopCaptureHelperState = Schema.Struct({
  status: Schema.Literals(["not-installed", "update-required", "ready", "error"]),
  message: Schema.String,
  feedbackAvailable: Schema.optional(Schema.Boolean),
});
export type DesktopCaptureHelperState = typeof DesktopCaptureHelperState.Type;

export const DesktopSnapShotSetupAction = Schema.Literals([
  "install-extension",
  "enable-extension",
  "disable-extension",
  "install-kde-helper",
  "remove-kde-helper",
  "install-hyprland-helper",
  "remove-hyprland-helper",
  "test-mac-capture",
  "allow-screen-recording",
  "allow-accessibility",
  "retry-shortcut",
]);
export type DesktopSnapShotSetupAction = typeof DesktopSnapShotSetupAction.Type;

export const DesktopCaptureConfigRequest = Schema.Struct({
  operation: Schema.Literals(["install", "remove"]),
  chooseFile: Schema.Boolean,
  shortcut: Schema.optional(Schema.String.check(Schema.isMaxLength(80))),
});
export type DesktopCaptureConfigRequest = typeof DesktopCaptureConfigRequest.Type;

export const DesktopCaptureConfigPreview = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  resolvedPath: Schema.String,
  before: Schema.String,
  after: Schema.String,
  shortcut: Schema.String,
  operation: Schema.Literals(["install", "remove"]),
});
export type DesktopCaptureConfigPreview = typeof DesktopCaptureConfigPreview.Type;

export const DesktopCaptureConfigApplied = Schema.Struct({
  backupPath: Schema.NullOr(Schema.String),
  warning: Schema.NullOr(Schema.String),
});
export type DesktopCaptureConfigApplied = typeof DesktopCaptureConfigApplied.Type;

export const DesktopSnapShotState = Schema.Struct({
  mode: DesktopSnapShotMode,
  windows: Schema.optional(Schema.Boolean),
  linuxDesktop: Schema.optional(Schema.Literals(["gnome", "kde", "niri", "hyprland"])),
  linuxBackend: Schema.optional(
    Schema.Literals(["screenshot-portal", "gnome-extension", "niri", "kde", "hyprland", "picker"]),
  ),
  linuxFeedbackAvailable: Schema.optional(Schema.Boolean),
  shortcut: SnapShotShortcut,
  shortcutRegistered: Schema.Boolean,
  shortcutPending: Schema.optional(Schema.Boolean),
  shortcutCanRetry: Schema.optional(Schema.Boolean),
  shortcutLabel: Schema.optional(Schema.String),
  shortcutMessage: Schema.NullOr(Schema.String),
  shortcutBinding: Schema.optional(Schema.String),
  shortcutConfigPath: Schema.optional(Schema.String),
  shortcutActionRegistered: Schema.optional(Schema.Boolean),
  gnomeExtension: Schema.optional(DesktopCaptureExtensionState),
  kdeHelper: Schema.optional(DesktopCaptureHelperState),
  hyprlandHelper: Schema.optional(DesktopCaptureHelperState),
  macPermissions: Schema.optional(
    Schema.Struct({ screenRecording: Schema.Boolean, accessibility: Schema.Boolean }),
  ),
  shortcutVerified: Schema.optional(Schema.Boolean),
  message: Schema.NullOr(Schema.String),
});
export type DesktopSnapShotState = typeof DesktopSnapShotState.Type;

export const DesktopSnapShotShortcutAvailability = Schema.Struct({
  available: Schema.Boolean,
  message: Schema.NullOr(Schema.String),
});
export type DesktopSnapShotShortcutAvailability = typeof DesktopSnapShotShortcutAvailability.Type;

export const DesktopSnapShotId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-f0-9-]+$/i),
);
export type DesktopSnapShotId = typeof DesktopSnapShotId.Type;

/** `id` is absent for failures before a capture exists. */
export const DesktopSnapShotEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("requested"), id: DesktopSnapShotId }),
  Schema.Struct({ type: Schema.Literal("started"), id: DesktopSnapShotId }),
  Schema.Struct({ type: Schema.Literal("ready"), id: DesktopSnapShotId }),
  Schema.Struct({ type: Schema.Literal("failed"), id: Schema.optional(DesktopSnapShotId) }),
  Schema.Struct({ type: Schema.Literal("shortcut-changed") }),
]);
export type DesktopSnapShotEvent = typeof DesktopSnapShotEvent.Type;

export const DesktopPendingSnapShot = Schema.Struct({
  id: DesktopSnapShotId,
  name: Schema.String,
  mimeType: Schema.Literal("image/png"),
  sizeBytes: Schema.Int,
  source: SnapShotSource,
});
export type DesktopPendingSnapShot = typeof DesktopPendingSnapShot.Type;

export const DesktopSnapShot = Schema.Struct({
  ...DesktopPendingSnapShot.fields,
  dataUrl: Schema.String,
});
export type DesktopSnapShot = typeof DesktopSnapShot.Type;

export const DesktopSnapShotAnimationDestination = Schema.Struct({
  id: DesktopSnapShotId,
  viewportFrame: Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
  }),
  backgroundColor: Schema.String,
  borderColor: Schema.String,
  borderWidth: Schema.Number,
  cornerRadius: Schema.Number,
  details: Schema.optional(
    Schema.Struct({
      appName: SnapShotSource.fields.appName,
      windowTitle: SnapShotSource.fields.windowTitle,
      appIconDataUrl: SnapShotSource.fields.appIconDataUrl,
    }),
  ),
});
export type DesktopSnapShotAnimationDestination = typeof DesktopSnapShotAnimationDestination.Type;

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  channel: DesktopUpdateChannel;
  currentVersion: string;
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  releaseNotes: ReadonlyArray<DesktopUpdateReleaseNote>;
  omittedReleaseCount: number;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
  notAppliedVersion?: string;
  /** Off only because a managed policy rules out this channel; switching channels turns it on. */
  channelBlockedByPolicy?: true;
}

export interface DesktopUpdateReleaseNote {
  version: string;
  items: ReadonlyArray<string>;
  totalItems: number;
  /** ISO time from the update feed for the offered version, else `YYYY-MM-DD` from a prerelease version. */
  releasedAt?: string;
  /** Paragraph-style summaries from older releases keep their fixes in `items`. */
  intro?: string;
  /** Generated summaries only, for example "275 changes from 22 contributors". */
  stats?: string;
  footer?: string;
}

export const DesktopCliCommandStateSchema = Schema.Struct({
  supported: Schema.Boolean,
  installedPath: Schema.NullOr(Schema.String),
  onPath: Schema.Boolean,
  shadowedBy: Schema.optionalKey(Schema.String),
  /** For an installed `t3` that is off PATH: the shell startup file that adds it, and whether it has. */
  pathSetup: Schema.optionalKey(Schema.Struct({ file: Schema.String, added: Schema.Boolean })),
  /** The app's bundled `t3` launcher, which runs without Node or a PATH entry. */
  launcherPath: Schema.NullOr(Schema.String),
});
export type DesktopCliCommandState = typeof DesktopCliCommandStateSchema.Type;

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export interface DesktopUpdateCheckResult {
  checked: boolean;
  state: DesktopUpdateState;
}

export interface DesktopEnvironmentBootstrap {
  // Stable backend identity used to reopen routed projects.
  id: string;
  label: string;
  // Actual distro for this run; id stays wsl:default when tracking the default.
  runningDistro?: string | null;
  httpBaseUrl: string | null;
  wsBaseUrl: string | null;
  bootstrapToken?: string;
}

export const DesktopSshEnvironmentTargetSchema = Schema.Struct({
  alias: Schema.String,
  hostname: Schema.String,
  username: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.Number),
});
export type DesktopSshEnvironmentTarget = typeof DesktopSshEnvironmentTargetSchema.Type;

export type DesktopSshHostSource = "ssh-config" | "known-hosts";

export interface DesktopDiscoveredSshHost extends DesktopSshEnvironmentTarget {
  source: DesktopSshHostSource;
}

export interface DesktopSshEnvironmentBootstrap {
  target: DesktopSshEnvironmentTarget;
  httpBaseUrl: string;
  wsBaseUrl: string;
  pairingToken: string | null;
  remotePort?: number;
  remoteServerKind?: "external" | "managed";
}

export interface DesktopSshPasswordPromptRequest {
  requestId: string;
  destination: string;
  username: string | null;
  prompt: string;
  expiresAt: string;
}

export type DesktopServerExposureMode = "local-only" | "network-accessible";

export interface DesktopServerExposureState {
  mode: DesktopServerExposureMode;
  endpointUrl: string | null;
  advertisedHost: string | null;
  tailscaleServeEnabled: boolean;
  tailscaleServePort: number;
}

export interface PickFolderOptions {
  initialPath?: string | null;
  targetEnvironmentId?: string;
}

/** Oversized files have empty text so the main process never loads their contents. */
export interface PickedThemeFile {
  name: string;
  size: number;
  text: string;
}

export interface DesktopWslDistro {
  name: string;
  isDefault: boolean;
  version: 1 | 2;
}

export interface DesktopWslState {
  enabled: boolean;
  // null means "track the current WSL default distro".
  distro: string | null;
  available: boolean;
  wslOnly: boolean;
  distros: readonly DesktopWslDistro[];
  // Always null in wsl-only mode, which falls back to Windows with a dialog.
  preflightError: string | null;
}

export const DesktopMediaReadSchema = Schema.Struct({
  status: Schema.Number,
  mimeType: Schema.String,
  data: Schema.Uint8Array,
});
export type DesktopMediaRead = typeof DesktopMediaReadSchema.Type;

export const SystemSettingsPaneSchema = Schema.Literals(["full-disk-access"]);
export type SystemSettingsPane = typeof SystemSettingsPaneSchema.Type;

export interface DesktopBridge {
  getAppBranding: () => DesktopAppBranding | null;
  getRelayTelemetryEnabled: () => boolean;
  getPathForFile: (file: File) => string;
  getClientPlatform: () => string;
  setNotificationBadge: (badge: { count: number; image: string | null }) => Promise<void>;
  onNotificationBadgeClear: (listener: () => void) => () => void;
  onTrackpadScrollBegin: (listener: () => void) => () => void;
  onTrackpadScrollEnd: (listener: () => void) => () => void;
  /**
   * Renderer `window.focus()` cannot raise an Electron window, and on Wayland
   * only the main process can spend a notification click's activation token.
   */
  revealWindow: () => Promise<void>;
  /**
   * The OS locale as a BCP-47 tag, which the renderer cannot read for itself:
   * the packaged app ships only the `en-US` Chromium locale pak, so
   * `navigator.language` and the default `Intl` locale are pinned to `en-US`
   * regardless of OS settings.
   */
  getSystemLocale: () => string | null;
  /** The OS's preferred languages, most preferred first; `navigator.languages` is pinned like the locale. */
  getPreferredSystemLanguages: () => readonly string[];
  getLocalEnvironmentBootstraps: () => readonly DesktopEnvironmentBootstrap[];
  getLocalEnvironmentEnabled: () => boolean;
  setLocalEnvironmentEnabled: (enabled: boolean) => Promise<void>;
  /** The environment ID recorded in this app's T3 home, such as its own machine's background service. */
  getHostEnvironmentId?: () => Promise<string | null>;
  getLocalEnvironmentBearerToken: () => Promise<string>;
  getClientSettings: () => Promise<ClientSettings | null>;
  setClientSettings: (settings: ClientSettings) => Promise<void>;
  getConnectionCatalog: () => Promise<string | null>;
  setConnectionCatalog: (catalog: string) => Promise<boolean>;
  discoverSshHosts: () => Promise<readonly DesktopDiscoveredSshHost[]>;
  resolveSshHost: (alias: string) => Promise<DesktopSshEnvironmentTarget>;
  requestSnapShotPermissions: (includeAccessibility: boolean) => Promise<void>;
  getSnapShotState: () => Promise<DesktopSnapShotState>;
  setupSnapShot: (action: DesktopSnapShotSetupAction) => Promise<void>;
  previewSnapShotConfig: (
    request: DesktopCaptureConfigRequest,
  ) => Promise<DesktopCaptureConfigPreview | null>;
  applySnapShotConfig: (previewId: string) => Promise<DesktopCaptureConfigApplied>;
  checkSnapShotShortcut: (
    shortcut: SnapShotShortcut,
  ) => Promise<DesktopSnapShotShortcutAvailability>;
  setSnapShotShortcutSuppressed: (suppressed: boolean) => Promise<void>;
  listPendingSnapShots: () => Promise<readonly DesktopPendingSnapShot[]>;
  readSnapShot: (id: string) => Promise<DesktopSnapShot>;
  setSnapShotAnimationDestination: (
    destination: DesktopSnapShotAnimationDestination,
  ) => Promise<void>;
  dismissSnapShotAnimation: (id: DesktopSnapShotId) => Promise<void>;
  acknowledgeSnapShot: (id: string) => Promise<void>;
  ensureSshEnvironment: (
    target: DesktopSshEnvironmentTarget,
    options?: { issuePairingToken?: boolean },
  ) => Promise<DesktopSshEnvironmentBootstrap>;
  disconnectSshEnvironment: (target: DesktopSshEnvironmentTarget) => Promise<void>;
  fetchSshEnvironmentDescriptor: (httpBaseUrl: string) => Promise<ExecutionEnvironmentDescriptor>;
  bootstrapSshBearerSession: (
    httpBaseUrl: string,
    credential: string,
  ) => Promise<AuthAccessTokenResult>;
  fetchSshSessionState: (httpBaseUrl: string, bearerToken: string) => Promise<AuthSessionState>;
  onSshPasswordPrompt: (listener: (request: DesktopSshPasswordPromptRequest) => void) => () => void;
  resolveSshPasswordPrompt: (requestId: string, password: string | null) => Promise<void>;
  getServerExposureState: () => Promise<DesktopServerExposureState>;
  setServerExposureMode: (mode: DesktopServerExposureMode) => Promise<DesktopServerExposureState>;
  setTailscaleServeEnabled: (input: {
    readonly enabled: boolean;
    readonly port?: number;
  }) => Promise<DesktopServerExposureState>;
  getAdvertisedEndpoints: () => Promise<readonly AdvertisedEndpoint[]>;
  getWslState: () => Promise<DesktopWslState>;
  setWslBackendEnabled: (enabled: boolean) => Promise<DesktopWslState>;
  setWslDistro: (distro: string | null) => Promise<DesktopWslState>;
  setWslOnly: (enabled: boolean) => Promise<DesktopWslState>;
  pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
  pickProjectFavicon: (initialPath?: string) => Promise<string | null>;
  pickThemeFiles: () => Promise<readonly PickedThemeFile[] | null>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  receiveProviderAuthCallback: (authorizationUrl: string) => Promise<string>;
  cancelProviderAuthCallback: (authorizationUrl: string) => Promise<void>;
  openExternal: (url: string) => Promise<boolean>;
  /** Reads http(s) media in the main process, outside renderer CORS and CSP; null on network failure. */
  readMedia: (url: string) => Promise<DesktopMediaRead | null>;
  openSystemSettings: (pane: SystemSettingsPane) => Promise<boolean>;
  checkSystemPermission: (pane: SystemSettingsPane) => Promise<boolean>;
  probeRemoteEditors: () => Promise<readonly EditorId[]>;
  pasteAsText: () => Promise<void>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  onSnapShotEvent: (listener: (event: DesktopSnapShotEvent) => void) => () => void;
  onQuitShortcut: (listener: (event: QuitShortcutHintEvent) => void) => () => void;
  getWindowFullscreenState: () => boolean;
  onWindowFullscreenStateChange: (listener: (fullscreen: boolean) => void) => () => void;
  getWindowZoomFactor: () => number;
  getUpdateState: () => Promise<DesktopUpdateState>;
  /** `minimumVersion` is a track switch's checked release; nothing older is offered after. */
  setUpdateChannel: (
    channel: DesktopUpdateChannel,
    minimumVersion?: string,
  ) => Promise<DesktopUpdateState>;
  checkForUpdate: () => Promise<DesktopUpdateCheckResult>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  /** With a version, installs only that downloaded build. */
  installUpdate: (expectedVersion?: string) => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
  cliCommand: {
    getState: () => Promise<DesktopCliCommandState>;
    install: () => Promise<DesktopCliCommandState>;
    uninstall: () => Promise<DesktopCliCommandState>;
    addToPath: () => Promise<DesktopCliCommandState>;
  };
  webLinks: {
    setReady: (ready: boolean) => Promise<void>;
    onOpen: (listener: (url: string) => void) => () => void;
  };
  appActivation: {
    setReady: (ready: boolean) => Promise<void>;
    complete: (response: DesktopAppActivationResponse) => Promise<void>;
    onRequest: (listener: (request: DesktopAppActivationRequest) => void) => () => void;
  };
}

export type ConfirmDialogVariant = "default" | "destructive";

export interface ConfirmDialogOptions {
  readonly variant?: ConfirmDialogVariant;
}

export interface LocalApi {
  dialogs: {
    pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
    confirm: (message: string, options?: ConfirmDialogOptions) => Promise<boolean>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
    openSystemSettings: (pane: SystemSettingsPane) => Promise<void>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
    close: () => Promise<void>;
  };
  persistence: {
    getClientSettings: () => Promise<ClientSettings | null>;
    setClientSettings: (settings: ClientSettings) => Promise<void>;
  };
}
