import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AcpRegistryUrlAuthAction } from "./acpRegistry";
import { type EnvironmentMachineKind, ExecutionEnvironmentDescriptor } from "./environment";
import { ServerAuthDescriptor } from "./auth";
import {
  ForwardCompatibleArray,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import {
  KeybindingCommand,
  KeybindingValue,
  KeybindingWhen,
  ResolvedKeybindingsConfig,
} from "./keybindings";
import { EditorId, FileManagerRevealKind, RemoteOpenTarget } from "./editor";
import { ManagedPolicySummary } from "./managedPolicy";
import { ModelCapabilities, ProviderOptionDescriptor } from "./model";
import { RuntimeMode } from "./providerPolicy";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance";
import { ServerProviderUsageLimits, UsageLimitSourceSnapshots } from "./providerUsageLimits";
import { ServerSettings } from "./settings";

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

const ServerConfigIssues = ForwardCompatibleArray(ServerConfigIssue);

export const ServerProviderState = Schema.Literals(["ready", "warning", "error", "disabled"]);
export type ServerProviderState = typeof ServerProviderState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderAuth = Schema.Struct({
  status: ServerProviderAuthStatus,
  type: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(TrimmedNonEmptyString),
  email: Schema.optional(TrimmedNonEmptyString),
  action: Schema.optional(AcpRegistryUrlAuthAction),
  canLogout: Schema.optional(Schema.Boolean),
  subscriptionSharing: Schema.optional(Schema.Boolean),
  profileId: Schema.optional(TrimmedNonEmptyString),
  workspaceId: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderAuth = typeof ServerProviderAuth.Type;

export const ServerProviderModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  shortName: Schema.optional(TrimmedNonEmptyString),
  subProvider: Schema.optional(TrimmedNonEmptyString),
  aliases: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  badge: Schema.optional(Schema.Literal("new")),
  isCustom: Schema.Boolean,
  isDefault: Schema.optional(Schema.Boolean),
  isLegacy: Schema.optional(Schema.Boolean),
  capabilities: Schema.NullOr(ModelCapabilities),
});
export type ServerProviderModel = typeof ServerProviderModel.Type;

export const ServerProviderUpdateRequiredModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  badge: Schema.optional(Schema.Literal("new")),
  minVersion: TrimmedNonEmptyString,
});
export type ServerProviderUpdateRequiredModel = typeof ServerProviderUpdateRequiredModel.Type;

export const ServerProviderSlashCommandInput = Schema.Struct({
  hint: TrimmedNonEmptyString,
});
export type ServerProviderSlashCommandInput = typeof ServerProviderSlashCommandInput.Type;

export const ServerProviderSlashCommand = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  input: Schema.optional(ServerProviderSlashCommandInput),
});
export type ServerProviderSlashCommand = typeof ServerProviderSlashCommand.Type;

export const ServerProviderSkill = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  path: TrimmedNonEmptyString,
  scope: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  displayName: Schema.optional(TrimmedNonEmptyString),
  shortDescription: Schema.optional(TrimmedNonEmptyString),
  /** Claude disable-model-invocation: only users can invoke; composers must offer a slash command. */
  userInvocationOnly: Schema.optional(Schema.Boolean),
  /** Claude user-invocable:false: only agents can invoke; composers must hide the slash command. */
  userInvocable: Schema.optional(Schema.Boolean),
});
export type ServerProviderSkill = typeof ServerProviderSkill.Type;

export const ServerProviderWorkspaceSnapshot = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  checkedAt: IsoDateTime,
  slashCommands: Schema.Array(ServerProviderSlashCommand),
  slashCommandsPending: Schema.optional(Schema.Boolean),
  skills: Schema.Array(ServerProviderSkill),
  optionDescriptors: Schema.optional(Schema.Array(ProviderOptionDescriptor)),
});
export type ServerProviderWorkspaceSnapshot = typeof ServerProviderWorkspaceSnapshot.Type;

/** Unavailable snapshots must set installed and enabled false. */
export const ServerProviderAvailability = Schema.Literals(["available", "unavailable"]);
export type ServerProviderAvailability = typeof ServerProviderAvailability.Type;

export const ServerProviderContinuation = Schema.Struct({
  groupKey: TrimmedNonEmptyString,
});
export type ServerProviderContinuation = typeof ServerProviderContinuation.Type;

export const ServerProviderCompatibilityStatus = Schema.Literals([
  "unknown",
  "supported",
  "graceful",
  "unsupported",
  "broken",
]);
export const ServerProviderCompatibilityAdvisory = Schema.Struct({
  status: ServerProviderCompatibilityStatus,
  latestVersionStatus: Schema.optionalKey(ServerProviderCompatibilityStatus),
  message: Schema.NullOr(TrimmedNonEmptyString),
  recommendedVersion: Schema.NullOr(TrimmedNonEmptyString),
  recommendedRange: Schema.NullOr(TrimmedNonEmptyString),
});
export type ServerProviderCompatibilityAdvisory = typeof ServerProviderCompatibilityAdvisory.Type;

export const ServerProviderVersionAdvisoryStatus = Schema.Literals([
  "unknown",
  "current",
  "behind_latest",
]);
export type ServerProviderVersionAdvisoryStatus = typeof ServerProviderVersionAdvisoryStatus.Type;

export const ServerProviderVersionAdvisory = Schema.Struct({
  status: ServerProviderVersionAdvisoryStatus,
  currentVersion: Schema.NullOr(TrimmedNonEmptyString),
  latestVersion: Schema.NullOr(TrimmedNonEmptyString),
  updateCommand: Schema.NullOr(TrimmedNonEmptyString),
  canUpdate: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  canInstallVersion: Schema.optionalKey(Schema.Boolean),
  checkedAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(TrimmedNonEmptyString),
});
export type ServerProviderVersionAdvisory = typeof ServerProviderVersionAdvisory.Type;

export const ServerProviderUpdateStatus = Schema.Literals([
  "idle",
  "queued",
  "running",
  "succeeded",
  "failed",
  "unchanged",
]);
export type ServerProviderUpdateStatus = typeof ServerProviderUpdateStatus.Type;

export const ServerProviderUpdateState = Schema.Struct({
  status: ServerProviderUpdateStatus,
  startedAt: Schema.NullOr(IsoDateTime),
  finishedAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(TrimmedNonEmptyString),
  output: Schema.NullOr(Schema.String.check(Schema.isMaxLength(10_000))),
});
export type ServerProviderUpdateState = typeof ServerProviderUpdateState.Type;

export const ServerProvider = Schema.Struct({
  // Only instanceId is stable enough for provider routing.
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  displayName: Schema.optional(TrimmedNonEmptyString),
  accentColor: Schema.optional(TrimmedNonEmptyString),
  // Validate driver-supplied remote icons against the driver's trusted origin.
  iconUrl: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(2_048))),
  badgeLabel: Schema.optional(TrimmedNonEmptyString),
  continuation: Schema.optional(ServerProviderContinuation),
  showInteractionModeToggle: Schema.optional(Schema.Boolean),
  reportsContextWindow: Schema.optional(Schema.Boolean),
  supportedRuntimeModes: Schema.optional(ForwardCompatibleArray(RuntimeMode)),
  supportsConversationRollback: Schema.optional(Schema.Boolean),
  supportsTextGeneration: Schema.optional(Schema.Boolean),
  setup: Schema.optional(
    Schema.Struct({
      canAuthenticate: Schema.Boolean,
      canInstall: Schema.Boolean,
      documentationUrl: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(2_048))),
    }),
  ),
  nativeSessions: Schema.optional(
    Schema.Struct({
      canList: Schema.Boolean,
      canLoad: Schema.Boolean,
      canResume: Schema.Boolean,
      canDelete: Schema.optional(Schema.Boolean),
    }),
  ),
  configurableProviders: Schema.optional(Schema.Boolean),
  runtimePaths: Schema.optionalKey(
    Schema.Struct({
      homePath: TrimmedNonEmptyString,
      shadowHomePath: Schema.NullOr(TrimmedNonEmptyString),
    }),
  ),
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  version: Schema.NullOr(TrimmedNonEmptyString),
  // Version reported by the installed CLI for a local provider with a separate
  // server. Null means unknown; absence keeps legacy snapshots on `version`.
  installedVersion: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  status: ServerProviderState,
  auth: ServerProviderAuth,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
  availability: Schema.optional(ServerProviderAvailability),
  unavailableReason: Schema.optional(TrimmedNonEmptyString),
  models: Schema.Array(ServerProviderModel),
  // Kept apart from `models` so clients that predate it never offer them.
  updateRequiredModels: Schema.optionalKey(Schema.Array(ServerProviderUpdateRequiredModel)),
  slashCommands: Schema.Array(ServerProviderSlashCommand).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  skills: Schema.Array(ServerProviderSkill).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  workspaceSnapshots: Schema.optionalKey(Schema.Array(ServerProviderWorkspaceSnapshot)),
  usageLimits: Schema.optional(ServerProviderUsageLimits),
  versionAdvisory: Schema.optionalKey(ServerProviderVersionAdvisory),
  compatibilityAdvisory: Schema.optionalKey(ServerProviderCompatibilityAdvisory),
  updateState: Schema.optionalKey(ServerProviderUpdateState),
});
export type ServerProvider = typeof ServerProvider.Type;

export const ServerProviders = ForwardCompatibleArray(ServerProvider);
export type ServerProviders = typeof ServerProviders.Type;

export const isProviderAvailable = (snapshot: ServerProvider): boolean =>
  snapshot.availability !== "unavailable";

export const OtlpEndpointSource = Schema.Literals(["environment", "bootstrap", "settings"]);
export type OtlpEndpointSource = typeof OtlpEndpointSource.Type;

export const ServerObservability = Schema.Struct({
  logsDirectoryPath: TrimmedNonEmptyString,
  localTracingEnabled: Schema.Boolean,
  otlpTracesUrl: Schema.optional(TrimmedNonEmptyString),
  otlpTracesSource: Schema.optional(OtlpEndpointSource),
  otlpTracesVariable: Schema.optional(TrimmedNonEmptyString),
  otlpTracesEnabled: Schema.Boolean,
  otlpMetricsUrl: Schema.optional(TrimmedNonEmptyString),
  otlpMetricsSource: Schema.optional(OtlpEndpointSource),
  otlpMetricsVariable: Schema.optional(TrimmedNonEmptyString),
  otlpMetricsEnabled: Schema.Boolean,
  otlpLogsUrl: Schema.optional(TrimmedNonEmptyString),
  otlpLogsSource: Schema.optional(OtlpEndpointSource),
  otlpLogsVariable: Schema.optional(TrimmedNonEmptyString),
  otlpLogsEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type ServerObservability = typeof ServerObservability.Type;

export const EnvironmentThemeColor = Schema.String.check(
  Schema.isPattern(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
);
export type EnvironmentThemeColor = typeof EnvironmentThemeColor.Type;

/** Reserve appearance keywords so published themes cannot replace stock preferences. */
export const EnvironmentThemeId = Schema.String.check(
  Schema.isPattern(/^(?!(?:system|light|dark)$)[a-z0-9](?:[a-z0-9-]{0,47})$/),
);
export type EnvironmentThemeId = typeof EnvironmentThemeId.Type;

const EnvironmentThemeColors = Schema.Record(
  Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/)),
  TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
);

const environmentThemeFields = {
  version: Schema.optional(Schema.Literal(1)),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(48)),
  appearance: Schema.Literals(["light", "dark"]),
  /** Derive the palette from canvas/accent, then overlay colors; without them, colors is the palette. */
  canvas: Schema.optional(EnvironmentThemeColor),
  accent: Schema.optional(EnvironmentThemeColor),
  colors: Schema.optional(EnvironmentThemeColors),
  variants: Schema.optional(
    Schema.Struct({
      light: Schema.optional(EnvironmentThemeColors),
      dark: Schema.optional(EnvironmentThemeColors),
    }),
  ),
};

export const EnvironmentTheme = Schema.Struct({
  id: EnvironmentThemeId,
  ...environmentThemeFields,
});
export type EnvironmentTheme = typeof EnvironmentTheme.Type;

/** tailnet means this machine's Tailscale interface; other private addresses are lan. */
export const ServerDirectEndpointKind = Schema.Literals(["lan", "tailnet"]);
export type ServerDirectEndpointKind = typeof ServerDirectEndpointKind.Type;

export const ServerDirectEndpoint = Schema.Struct({
  kind: ServerDirectEndpointKind,
  httpBaseUrl: TrimmedNonEmptyString,
});
export type ServerDirectEndpoint = typeof ServerDirectEndpoint.Type;

/**
 * A stretch where the server's event loop could not run, so it answered
 * nothing and clients may have dropped the connection.
 */
export const ServerEventLoopStall = Schema.Struct({
  detectedAt: IsoDateTime,
  durationMs: NonNegativeInt,
  /** One-minute load average when the stall was seen. Absent on Windows, which has none. */
  loadAverage: Schema.optionalKey(Schema.Number),
  cpuCount: PositiveInt,
});
export type ServerEventLoopStall = typeof ServerEventLoopStall.Type;

export const ServerConfig = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
  auth: ServerAuthDescriptor,
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviders,
  availableEditors: ForwardCompatibleArray(EditorId),
  remoteOpenTargets: Schema.optionalKey(ForwardCompatibleArray(RemoteOpenTarget)),
  /** Hints only; verify each address answers as this environment. */
  directEndpoints: Schema.optionalKey(ForwardCompatibleArray(ServerDirectEndpoint)),
  observability: ServerObservability,
  settings: ServerSettings,
  /** Present when an administrator's policy file manages this environment. */
  managedPolicy: Schema.optionalKey(ManagedPolicySummary),
  shellResumeCompletionMarker: Schema.optionalKey(Schema.Boolean),
  /**
   * The shell can leave idle subagent children out of snapshots (`omitIdleSubagents`), and
   * `getThreadFamily` and `getWorktreeThreadIds` serve the rows it leaves out.
   */
  shellThreadFamilies: Schema.optionalKey(Schema.Boolean),
  threadLinkMetadata: Schema.optionalKey(Schema.Boolean),
  /**
   * The shell can leave older settled threads out of snapshots (`omitOlderSettled`), and
   * `getOlderSettledThreads` serves them. Only servers that also advertise `shellThreadFamilies`.
   */
  shellOlderSettled: Schema.optionalKey(Schema.Boolean),
  shellRevealInFileManager: Schema.optionalKey(Schema.Boolean),
  shellRevealInFileManagerKind: Schema.optionalKey(FileManagerRevealKind),
  threadResumeCompletionMarker: Schema.optionalKey(Schema.Boolean),
  /** Send window fields only when advertised. */
  threadSnapshotPagination: Schema.optionalKey(Schema.Boolean),
  threadFind: Schema.optionalKey(Schema.Boolean),
  threadFindProgressive: Schema.optionalKey(Schema.Boolean),
  /** Settings patches may carry `secretProviders`; older servers drop the key without an error. */
  secretProviderSettings: Schema.optionalKey(Schema.Boolean),
  /** Secret settings may point at a secret provider; older servers drop the reference. */
  secretReferences: Schema.optionalKey(Schema.Boolean),
  /** A secret request card may be answered with a secret provider reference. */
  secretRequestReferences: Schema.optionalKey(Schema.Boolean),
  scratchWorkspaceRoot: Schema.optionalKey(TrimmedNonEmptyString),
  newProjectsRoot: Schema.optionalKey(TrimmedNonEmptyString),
  /**
   * The latest stall long enough to notice, sent only for a few minutes after
   * it. A client that reconnects reads it to say why the host stopped
   * answering. Clients do not cache it, since it describes the host at connect.
   */
  lastEventLoopStall: Schema.optionalKey(ServerEventLoopStall),
  /**
   * Never sent in a config snapshot: the theme stream emits the current set
   * before any change, so a snapshot carrying it too would hand every
   * subscriber the same array twice per connect.
   */
  environmentThemes: Schema.optional(Schema.Array(EnvironmentTheme)),
  /** Stream-only and opt-in; the source stream emits the current set on subscribe. */
  usageLimitSources: Schema.optional(UsageLimitSourceSnapshots),
});
export type ServerConfig = typeof ServerConfig.Type;

export function resolveEnvironmentMachineKind(
  config: {
    readonly environment: Pick<ExecutionEnvironmentDescriptor, "platform">;
    readonly settings?: Pick<ServerSettings, "environmentIcon">;
  } | null,
): EnvironmentMachineKind {
  return config?.settings?.environmentIcon ?? config?.environment.platform.machine ?? "server";
}

const ServerUpsertKeybindingReplaceTarget = Schema.Struct({
  key: KeybindingValue,
  command: KeybindingCommand,
  when: Schema.optional(KeybindingWhen),
});

export const ServerUpsertKeybindingInput = Schema.Struct({
  key: KeybindingValue,
  command: KeybindingCommand,
  when: Schema.optional(KeybindingWhen),
  replace: Schema.optional(ServerUpsertKeybindingReplaceTarget),
});
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerRemoveKeybindingInput = ServerUpsertKeybindingReplaceTarget;
export type ServerRemoveKeybindingInput = typeof ServerRemoveKeybindingInput.Type;

