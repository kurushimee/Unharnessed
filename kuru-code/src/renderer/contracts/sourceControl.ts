import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";
import { VcsDriverKind } from "./vcs";

/** Accept unknown hosts so clients can fall back to generic presentation. */
export const SourceControlProviderKind = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z][a-z0-9-]*$/),
).pipe(Schema.brand("SourceControlProviderKind"));
export type SourceControlProviderKind = typeof SourceControlProviderKind.Type;

export const SourceControlProviderInfo = Schema.Struct({
  kind: SourceControlProviderKind,
  name: TrimmedNonEmptyString,
  baseUrl: Schema.String,
});
export type SourceControlProviderInfo = typeof SourceControlProviderInfo.Type;

export const ChangeRequestState = Schema.Literals(["open", "closed", "merged"]);
export type ChangeRequestState = typeof ChangeRequestState.Type;

export const ChangeRequest = Schema.Struct({
  provider: SourceControlProviderKind,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: Schema.String,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  headSha: Schema.optional(TrimmedNonEmptyString),
  state: ChangeRequestState,
  isDraft: Schema.optional(Schema.Boolean),
  closedAt: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: Schema.Option(Schema.DateTimeUtc),
  isCrossRepository: Schema.optional(Schema.Boolean),
  headRepositoryNameWithOwner: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  headRepositoryOwnerLogin: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type ChangeRequest = typeof ChangeRequest.Type;

export const SourceControlRepositoryCloneUrls = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});
export type SourceControlRepositoryCloneUrls = typeof SourceControlRepositoryCloneUrls.Type;

export const SourceControlRepositoryVisibility = Schema.Literals(["private", "public"]);
export type SourceControlRepositoryVisibility = typeof SourceControlRepositoryVisibility.Type;

export const SourceControlRepositoryInfo = Schema.Struct({
  provider: SourceControlProviderKind,
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});
export type SourceControlRepositoryInfo = typeof SourceControlRepositoryInfo.Type;

export const SourceControlDiscoveryStatus = Schema.Literals(["available", "missing"]);
export type SourceControlDiscoveryStatus = typeof SourceControlDiscoveryStatus.Type;

export const SourceControlProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type SourceControlProviderAuthStatus = typeof SourceControlProviderAuthStatus.Type;

export const SourceControlProviderAuth = Schema.Struct({
  status: SourceControlProviderAuthStatus,
  account: Schema.Option(TrimmedNonEmptyString),
  host: Schema.Option(TrimmedNonEmptyString),
  detail: Schema.Option(TrimmedNonEmptyString),
  accounts: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        host: TrimmedNonEmptyString,
        account: TrimmedNonEmptyString,
        active: Schema.Boolean,
        authenticated: Schema.Boolean,
        error: Schema.optionalKey(TrimmedNonEmptyString),
        /** Set when the login comes from a token variable such as `GH_TOKEN`, which wins over Settings. */
        environmentVariable: Schema.optionalKey(TrimmedNonEmptyString),
      }),
    ),
  ),
});
export type SourceControlProviderAuth = typeof SourceControlProviderAuth.Type;

const SourceControlDiscoverySharedFields = {
  label: TrimmedNonEmptyString,
  executable: Schema.optional(TrimmedNonEmptyString),
  status: SourceControlDiscoveryStatus,
  version: Schema.Option(TrimmedNonEmptyString),
  installHint: TrimmedNonEmptyString,
  detail: Schema.Option(TrimmedNonEmptyString),
} as const;

export const VcsDiscoveryItem = Schema.Struct({
  kind: VcsDriverKind,
  implemented: Schema.Boolean,
  ...SourceControlDiscoverySharedFields,
});
export type VcsDiscoveryItem = typeof VcsDiscoveryItem.Type;

export const SourceControlProviderDiscoveryItem = Schema.Struct({
  kind: SourceControlProviderKind,
  ...SourceControlDiscoverySharedFields,
  auth: SourceControlProviderAuth,
  /** The server is configured to sign in through the host's app; clients offer it only then. */
  appSignIn: Schema.optionalKey(Schema.Boolean),
});
export type SourceControlProviderDiscoveryItem = typeof SourceControlProviderDiscoveryItem.Type;

export const SourceControlDiscoveryResult = Schema.Struct({
  versionControlSystems: Schema.Array(VcsDiscoveryItem),
  sourceControlProviders: Schema.Array(SourceControlProviderDiscoveryItem),
});
export type SourceControlDiscoveryResult = typeof SourceControlDiscoveryResult.Type;

export class SourceControlProviderError extends Schema.TaggedError<SourceControlProviderError>()(
  "SourceControlProviderError",
  {
    provider: SourceControlProviderKind,
    operation: Schema.String,
    cwd: Schema.String,
    command: Schema.optional(Schema.String),
    repository: Schema.optional(Schema.String),
    reference: Schema.optional(Schema.String),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Source control provider ${this.provider} failed in ${this.operation}: ${this.detail}`;
  }
}

export const SourceControlAppAccessInput = Schema.Struct({
  provider: SourceControlProviderKind,
  host: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
});
export type SourceControlAppAccessInput = typeof SourceControlAppAccessInput.Type;

