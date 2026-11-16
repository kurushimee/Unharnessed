// T3 Code's environment registry, for kuru code: T3 Code's holds the
// environments it knows, each with its supervisor, and runs effects in one;
// kuru code's holds its one, this machine (kuru/environment.ts).
import { EnvironmentId, type EnvironmentId as EnvironmentIdType } from "~/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { ConnectionCatalogEntry, NetworkStatus, SupervisorConnectionState } from "./index";
import * as EnvironmentSupervisor from "./supervisor";

export class EnvironmentNotRegisteredError extends Schema.TaggedError<EnvironmentNotRegisteredError>()(
  "EnvironmentNotRegisteredError",
  { environmentId: EnvironmentId },
) {
  override get message(): string {
    return `Environment ${this.environmentId} is not registered.`;
  }
}

export class EnvironmentRegistry extends Context.Service<
  EnvironmentRegistry,
  {
    readonly entries: SubscriptionRef.SubscriptionRef<ReadonlyMap<EnvironmentIdType, ConnectionCatalogEntry>>;
    readonly networkStatus: SubscriptionRef.SubscriptionRef<NetworkStatus>;
    readonly retryNow: (environmentId: EnvironmentIdType) => Effect.Effect<void>;
    readonly state: (
      environmentId: EnvironmentIdType,
    ) => Effect.Effect<SupervisorConnectionState, EnvironmentNotRegisteredError>;
    readonly stateChanges: (
      environmentId: EnvironmentIdType,
    ) => Stream.Stream<SupervisorConnectionState, EnvironmentNotRegisteredError>;
    readonly run: <A, E, R>(
      environmentId: EnvironmentIdType,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | EnvironmentNotRegisteredError, Exclude<R, EnvironmentSupervisor.EnvironmentSupervisor>>;
    readonly runStream: <A, E, R>(
      environmentId: EnvironmentIdType,
      stream: Stream.Stream<A, E, R>,
    ) => Stream.Stream<A, E | EnvironmentNotRegisteredError, Exclude<R, EnvironmentSupervisor.EnvironmentSupervisor>>;
    readonly followStream: <A, E, R>(
      environmentId: EnvironmentIdType,
      stream: Stream.Stream<A, E, R>,
    ) => Stream.Stream<A, E, Exclude<R, EnvironmentSupervisor.EnvironmentSupervisor>>;
  }
>()("@t3tools/client-runtime/connection/registry/EnvironmentRegistry") {}

/** The registry of kuru code's one environment, whose supervisor is always connected. */
export function makeLocal(entry: ConnectionCatalogEntry, prepared: Parameters<typeof EnvironmentSupervisor.makeConnected>[1]) {
  return Effect.gen(function* () {
    const environmentId = entry.target.environmentId;
    const supervisor = yield* EnvironmentSupervisor.makeConnected(entry, prepared);
    const provide = Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
    const provideStream = Stream.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
    const notRegistered = (id: EnvironmentIdType) => new EnvironmentNotRegisteredError({ environmentId: id });
    // oxlint-disable-next-line typescript/no-explicit-any
    const service: EnvironmentRegistry["Service"] = {
      entries: yield* SubscriptionRef.make<ReadonlyMap<EnvironmentIdType, ConnectionCatalogEntry>>(new Map([[environmentId, entry]])),
      networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
      retryNow: () => Effect.void,
      state: (id) => (id === environmentId ? SubscriptionRef.get(supervisor.state) : Effect.fail(notRegistered(id))),
      stateChanges: (id) => (id === environmentId ? SubscriptionRef.changes(supervisor.state) : Stream.fail(notRegistered(id))),
      // oxlint-disable-next-line typescript/no-explicit-any
      run: (id, effect) => (id === environmentId ? provide(effect) : Effect.fail(notRegistered(id))) as any,
      // oxlint-disable-next-line typescript/no-explicit-any
      runStream: (id, stream) => (id === environmentId ? provideStream(stream) : Stream.fail(notRegistered(id))) as any,
      // oxlint-disable-next-line typescript/no-explicit-any
      followStream: (id, stream) => (id === environmentId ? provideStream(stream) : Stream.empty) as any,
    };
    return service;
  });
}

export const layerLocal = (entry: ConnectionCatalogEntry, prepared: Parameters<typeof EnvironmentSupervisor.makeConnected>[1]) =>
  Layer.effect(EnvironmentRegistry, makeLocal(entry, prepared));
