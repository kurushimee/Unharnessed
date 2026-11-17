import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpApiSecurity from "effect/http-api/HttpApiSecurity";
import * as OpenApi from "effect/http-api/OpenApi";

import { DpopFailureReason, TrimmedNonEmptyString } from "./baseSchemas";

export const RelayAuthInvalidReason = Schema.Literals([
  "missing_bearer",
  "invalid_bearer",
  "invalid_dpop",
  "not_authorized",
]);
export type RelayAuthInvalidReason = typeof RelayAuthInvalidReason.Type;

export const RelayDpopFailureReason = DpopFailureReason;
export type RelayDpopFailureReason = typeof RelayDpopFailureReason.Type;

export const RelayInternalErrorReason = Schema.Literals([
  "database_unavailable",
  "persistence_failed",
  "upstream_unavailable",
  "internal_error",
]);
export type RelayInternalErrorReason = typeof RelayInternalErrorReason.Type;

export class RelayAuthInvalidError extends Schema.TaggedError<RelayAuthInvalidError>()(
  "RelayAuthInvalidError",
  {
    code: Schema.Literal("auth_invalid"),
    reason: RelayAuthInvalidReason,
    dpopFailureReason: Schema.optionalKey(RelayDpopFailureReason),
    traceId: TrimmedNonEmptyString,
  },
  { httpApiStatus: 401 },
) {
  override get message(): string {
    return `Relay authentication failed: ${this.reason}`;
  }
}

export class RelayInternalError extends Schema.TaggedError<RelayInternalError>()(
  "RelayInternalError",
  {
    code: Schema.Literal("internal_error"),
    reason: RelayInternalErrorReason,
    traceId: TrimmedNonEmptyString,
  },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return `Relay internal error: ${this.reason}`;
  }
}

export class RelayClientPrincipal extends Context.Service<
  RelayClientPrincipal,
  {
    readonly userId: string;
    readonly token: string;
    readonly proofKeyThumbprint?: string;
    readonly dpopScopes?: ReadonlyArray<RelayDpopAccessTokenScope>;
  }
>()("@t3tools/contracts/relay/RelayClientPrincipal") {}

export class RelayEnvironmentPrincipal extends Context.Service<
  RelayEnvironmentPrincipal,
  {
    readonly environmentId: string;
    readonly environmentPublicKey: string;
  }
>()("@t3tools/contracts/relay/RelayEnvironmentPrincipal") {}

const RelayClientBearerAuthorization = HttpApiSecurity.http({ scheme: "bearer" }).pipe(
  HttpApiSecurity.annotate(
    OpenApi.Description,
    "Clerk session or OAuth bearer token for the signed-in T3 Connect user.",
  ),
);

export class RelayClientAuth extends HttpApiMiddleware.Service<
  RelayClientAuth,
  { provides: RelayClientPrincipal }
>()("RelayClientAuth", {
  error: RelayAuthInvalidError,
  security: { clientBearer: RelayClientBearerAuthorization },
}) {}

const RelayEnvironmentBearerAuthorization = HttpApiSecurity.http({ scheme: "bearer" }).pipe(
  HttpApiSecurity.annotate(
    OpenApi.Description,
    "Relay-issued environment credential installed when the environment is linked.",
  ),
);

export class RelayEnvironmentAuth extends HttpApiMiddleware.Service<
  RelayEnvironmentAuth,
  { provides: RelayEnvironmentPrincipal }
>()("RelayEnvironmentAuth", {
  error: [RelayAuthInvalidError, RelayInternalError],
  security: { environmentBearer: RelayEnvironmentBearerAuthorization },
}) {}

const RelayDpopAuthorization = HttpApiSecurity.http({ scheme: "DPoP" }).pipe(
  HttpApiSecurity.annotate(
    OpenApi.Description,
    "DPoP-bound access token. Requests must also include the DPoP proof JWT header.",
  ),
);

export class RelayDpopClientAuth extends HttpApiMiddleware.Service<
  RelayDpopClientAuth,
  { provides: RelayClientPrincipal }
>()("RelayDpopClientAuth", {
  error: RelayAuthInvalidError,
  security: { relayDpop: RelayDpopAuthorization },
}) {}

export const RelayEnvironmentConnectScope = "environment:connect" as const;
export const RelayEnvironmentStatusScope = "environment:status" as const;
export const RelayMobileRegistrationScope = "mobile:registration" as const;
export const RelayDpopAccessTokenScope = Schema.Literals([
  RelayEnvironmentConnectScope,
  RelayEnvironmentStatusScope,
  RelayMobileRegistrationScope,
]);
export type RelayDpopAccessTokenScope = typeof RelayDpopAccessTokenScope.Type;

