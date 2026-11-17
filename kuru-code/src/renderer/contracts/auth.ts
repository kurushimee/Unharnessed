import * as Schema from "effect/Schema";

import {
  ForwardCompatibleArray,
  ClientSurface,
  ClientWebDeployment,
  TrimmedNonEmptyString,
} from "./baseSchemas";

export const ServerAuthPolicy = Schema.Literals([
  "desktop-managed-local",
  "loopback-browser",
  "remote-reachable",
  "unsafe-no-auth",
]);
export type ServerAuthPolicy = typeof ServerAuthPolicy.Type;

export const ServerAuthBootstrapMethod = Schema.Literals(["desktop-bootstrap", "one-time-token"]);
export type ServerAuthBootstrapMethod = typeof ServerAuthBootstrapMethod.Type;

export const ServerAuthSessionMethod = Schema.Literals([
  "browser-session-cookie",
  "bearer-access-token",
  "dpop-access-token",
]);
export type ServerAuthSessionMethod = typeof ServerAuthSessionMethod.Type;

export const AuthOrchestrationReadScope = "orchestration:read" as const;
export const AuthOrchestrationOperateScope = "orchestration:operate" as const;
export const AuthSettingsWriteScope = "settings:write" as const;
export const AuthProvidersManageScope = "providers:manage" as const;
export const AuthEnvironmentMaintainScope = "environment:maintain" as const;
export const AuthPreviewOperateScope = "preview:operate" as const;
export const AuthDiagnosticsReadScope = "diagnostics:read" as const;
export const AuthTerminalReadScope = "terminal:read" as const;
export const AuthTerminalOperateScope = "terminal:operate" as const;
export const AuthSourceControlWriteScope = "source-control:write" as const;
export const AuthFilesystemReadScope = "filesystem:read" as const;
export const AuthFilesystemWriteScope = "filesystem:write" as const;
/** Retained for decoding existing credentials; grants no current RPC access. */
const AuthReviewWriteScope = "review:write" as const;
export const AuthAccessReadScope = "access:read" as const;
export const AuthAccessWriteScope = "access:write" as const;
export const AuthRelayReadScope = "relay:read" as const;
export const AuthRelayWriteScope = "relay:write" as const;
export const AuthEnvironmentScope = Schema.Literals([
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  AuthProvidersManageScope,
  AuthEnvironmentMaintainScope,
  AuthPreviewOperateScope,
  AuthDiagnosticsReadScope,
  AuthTerminalReadScope,
  AuthTerminalOperateScope,
  AuthFilesystemReadScope,
  AuthFilesystemWriteScope,
  AuthReviewWriteScope,
  AuthSourceControlWriteScope,
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
]);
export type AuthEnvironmentScope = typeof AuthEnvironmentScope.Type;
export const AuthEnvironmentScopes = Schema.Array(AuthEnvironmentScope);
export type AuthEnvironmentScopes = typeof AuthEnvironmentScopes.Type;

const authScopeResponseFields = {
  scopes: AuthEnvironmentScopes,
  permissions: Schema.optionalKey(ForwardCompatibleArray(AuthEnvironmentScope)),
};

export interface SessionGrantInput {
  readonly authenticated: boolean;
  readonly scopes?: ReadonlyArray<AuthEnvironmentScope> | undefined;
  readonly permissions?: ReadonlyArray<AuthEnvironmentScope> | undefined;
  readonly auth?: { readonly serverUpdateScope?: string | undefined } | undefined;
}

export const AuthAccessTokenType = "urn:ietf:params:oauth:token-type:access_token" as const;

export const ServerAuthDescriptor = Schema.Struct({
  policy: ServerAuthPolicy,
  bootstrapMethods: Schema.Array(ServerAuthBootstrapMethod),
  sessionMethods: Schema.Array(ServerAuthSessionMethod),
  sessionCookieName: TrimmedNonEmptyString,
  /** Older servers omit this and authorize self-updates with orchestration:operate. */
  serverUpdateScope: Schema.optionalKey(Schema.Literal(AuthEnvironmentMaintainScope)),
});
export type ServerAuthDescriptor = typeof ServerAuthDescriptor.Type;

export const AuthAccessTokenResult = Schema.Struct({
  access_token: TrimmedNonEmptyString,
  issued_token_type: Schema.Literal(AuthAccessTokenType),
  token_type: Schema.Literals(["Bearer", "DPoP"]),
  expires_in: Schema.Number,
  scope: TrimmedNonEmptyString,
});
export type AuthAccessTokenResult = typeof AuthAccessTokenResult.Type;

export const AuthMcpClientAccess = Schema.Literals([
  "read-only",
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
]);
export type AuthMcpClientAccess = typeof AuthMcpClientAccess.Type;

export class EnvironmentAuthorizationError extends Schema.TaggedError<EnvironmentAuthorizationError>()(
  "EnvironmentAuthorizationError",
  {
    message: Schema.String,
    requiredScope: AuthEnvironmentScope,
    requiredPermission: Schema.optionalKey(Schema.String),
  },
) {}

export const AuthSessionState = Schema.Struct({
  authenticated: Schema.Boolean,
  auth: ServerAuthDescriptor,
  scopes: Schema.optionalKey(AuthEnvironmentScopes),
  permissions: authScopeResponseFields.permissions,
  sessionMethod: Schema.optionalKey(ServerAuthSessionMethod),
  expiresAt: Schema.optionalKey(Schema.DateTimeUtc),
});
export type AuthSessionState = typeof AuthSessionState.Type;

