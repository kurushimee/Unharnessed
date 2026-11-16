// T3 Code's connection supervisor, for kuru code: T3 Code's keeps one
// environment's connection up, retrying and reporting its phase; kuru code's
// one environment is its main process, connected for the window's life.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { RpcSession } from "../rpc/session";
import { LOCAL_RPC_SESSION } from "../rpc/session";
import {
  CONNECTED_STATE,
  type ConnectionCatalogEntry,
  type ConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "./index";

export class EnvironmentSupervisor extends Context.Service<
  EnvironmentSupervisor,
  {
    readonly target: ConnectionTarget;
    readonly state: SubscriptionRef.SubscriptionRef<SupervisorConnectionState>;
    readonly session: SubscriptionRef.SubscriptionRef<Option.Option<RpcSession>>;
    readonly prepared: SubscriptionRef.SubscriptionRef<Option.Option<PreparedConnection>>;
    readonly connect: Effect.Effect<void>;
    readonly disconnect: Effect.Effect<void>;
    readonly retryNow: Effect.Effect<void>;
  }
>()("@t3tools/client-runtime/connection/supervisor/EnvironmentSupervisor") {}

export const makeConnected = Effect.fn("EnvironmentSupervisor.makeConnected")(function* (
  entry: ConnectionCatalogEntry,
  prepared: PreparedConnection,
) {
  return {
    target: entry.target,
    state: yield* SubscriptionRef.make(CONNECTED_STATE),
    session: yield* SubscriptionRef.make(Option.some(LOCAL_RPC_SESSION)),
    prepared: yield* SubscriptionRef.make(Option.some(prepared)),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  } satisfies EnvironmentSupervisor["Service"];
});
