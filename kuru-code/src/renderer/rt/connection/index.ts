// T3 Code's client-runtime connection module, the part kuru code's screens
// name. T3 Code connects to environments (its servers) over the network;
// kuru code's one environment is this machine, served by its own main
// process, always connected. Its catalog entry, presentation and prepared
// connection are built in kuru/environment.ts.
import type { EnvironmentId, ServerConfig } from "~/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export type { EnvironmentCatalogState } from "../state/connections";

/** The primary connection: the environment the window's own app serves. */
export interface ConnectionTarget {
  readonly _tag: "PrimaryConnectionTarget";
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly httpBaseUrl: string;
}

export interface ConnectionCatalogEntry {
  readonly target: ConnectionTarget;
  readonly profile: Option.Option<never>;
  readonly enabled: boolean;
  readonly unsupportedReason?: string;
  readonly serverUpdateRequired?: boolean;
}

export const ConnectionTransientReason = Schema.Literals([
  "network",
  "timeout",
  "transport",
  "endpoint-unavailable",
  "relay-unavailable",
  "remote-unavailable",
  "session-pending",
]);
export const ConnectionBlockedReason = Schema.Literals(["authentication", "configuration", "permission", "unsupported"]);

export class ConnectionTransientError extends Schema.TaggedError<ConnectionTransientError>()(
  "ConnectionTransientError",
  { reason: ConnectionTransientReason, detail: Schema.String, traceId: Schema.optionalKey(Schema.String) },
) {
  override get message(): string {
    return this.detail;
  }
}

export class ConnectionBlockedError extends Schema.TaggedError<ConnectionBlockedError>()(
  "ConnectionBlockedError",
  {
    reason: ConnectionBlockedReason,
    detail: Schema.String,
    traceId: Schema.optionalKey(Schema.String),
    serverUpdateRequired: Schema.optionalKey(Schema.Boolean),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export type ConnectionAttemptError = ConnectionTransientError | ConnectionBlockedError;

export interface PreparedConnection {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly socketUrl: string;
  readonly httpAuthorization: null;
  readonly target: ConnectionTarget;
}

export type EnvironmentConnectionPhase =
  | "available"
  | "offline"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "error"
  | "unsupported";

export interface EnvironmentConnectionPresentation {
  readonly phase: EnvironmentConnectionPhase;
  readonly error: string | null;
  readonly traceId: string | null;
}

export type NetworkStatus = "online" | "offline" | "unknown";
export type SupervisorConnectionPhase = "available" | "offline" | "connecting" | "backoff" | "connected" | "blocked";
export type ConnectionAttemptStage = "preparing" | "opening" | "synchronizing";

export interface SupervisorConnectionState {
  readonly desired: boolean;
  readonly network: NetworkStatus;
  readonly phase: SupervisorConnectionPhase;
  readonly stage: ConnectionAttemptStage | null;
  readonly attempt: number;
  readonly generation: number;
  readonly lastFailure: ConnectionAttemptError | null;
  readonly retryAt: number | null;
}

/** kuru code's one connection: its own main process, there for as long as the window is. */
export const CONNECTED_STATE: SupervisorConnectionState = Object.freeze({
  desired: true,
  network: "online",
  phase: "connected",
  stage: null,
  attempt: 0,
  generation: 1,
  lastFailure: null,
  retryAt: null,
});

export type EnvironmentServerConfig = Omit<ServerConfig, "providers">;

export interface EnvironmentPresentation {
  readonly entry: ConnectionCatalogEntry;
  readonly connection: EnvironmentConnectionPresentation;
  readonly serverConfig: EnvironmentServerConfig | null;
}

export function connectionStatusText(connection: EnvironmentConnectionPresentation): string {
  switch (connection.phase) {
    case "available":
      return "Available";
    case "offline":
      return "Offline";
    case "connecting":
      return "Connecting...";
    case "reconnecting":
      return connection.error ? `Failed to connect. Reconnecting... Reason: ${connection.error}` : "Reconnecting...";
    case "connected":
      return "Connected";
    case "unsupported":
      return "Client not supported";
    case "error":
      return connection.error ? `Connection failed. Reason: ${connection.error}` : "Connection failed";
  }
}

export function connectionStatusTitle(connection: EnvironmentConnectionPresentation): string {
  if (connection.phase === "reconnecting" && connection.error) return "Failed to connect. Reconnecting...";
  return connectionStatusText({ ...connection, error: null });
}

export function connectionCatalogDisplayUrl(_entry: ConnectionCatalogEntry): string | null {
  return null;
}

export function hasRelayRoute(_entry: ConnectionCatalogEntry): boolean {
  return false;
}
