// T3 Code's client-runtime platform/persistence.ts, the environment cache
// its git atoms use. T3 Code keeps the last branch lists of a remote server
// so its pickers open at once offline; kuru code's lists come from this
// machine, so its cache is the window's memory.
import type { EnvironmentId, ServerConfig, VcsListRefsResult } from "~/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export class ConnectionPersistenceError extends Schema.TaggedError<ConnectionPersistenceError>()(
  "ConnectionPersistenceError",
  {
    operation: Schema.Literals([
      "list-targets",
      "list-disabled-targets",
      "register-connection",
      "set-connection-routes",
      "remove-connection",
      "set-connection-enabled",
      "load-shell",
      "save-shell",
      "load-thread",
      "save-thread",
      "remove-thread",
      "load-server-config",
      "save-server-config",
      "load-vcs-refs",
      "save-vcs-refs",
      "remove-vcs-refs",
      "clear-vcs-refs",
      "clear-environment",
    ]),
    message: Schema.String,
  },
) {}

export class EnvironmentCacheStore extends Context.Service<
  EnvironmentCacheStore,
  {
    readonly loadServerConfig: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<Option.Option<ServerConfig>, ConnectionPersistenceError>;
    readonly saveServerConfig: (
      environmentId: EnvironmentId,
      config: ServerConfig,
    ) => Effect.Effect<void, ConnectionPersistenceError>;
    readonly loadVcsRefs: (
      environmentId: EnvironmentId,
      cwd: string,
    ) => Effect.Effect<Option.Option<VcsListRefsResult>, ConnectionPersistenceError>;
    readonly saveVcsRefs: (
      environmentId: EnvironmentId,
      cwd: string,
      refs: VcsListRefsResult,
    ) => Effect.Effect<void, ConnectionPersistenceError>;
    readonly removeVcsRefs: (environmentId: EnvironmentId, cwd: string) => Effect.Effect<void, ConnectionPersistenceError>;
    readonly clearVcsRefs: (environmentId: EnvironmentId) => Effect.Effect<void, ConnectionPersistenceError>;
    readonly clear: (environmentId: EnvironmentId) => Effect.Effect<void, ConnectionPersistenceError>;
  }
>()("@t3tools/client-runtime/platform/persistence/EnvironmentCacheStore") {}

/** The cache in the window's memory. */
export const layerMemoryCache = Layer.sync(EnvironmentCacheStore, () => {
  const configs = new Map<EnvironmentId, ServerConfig>();
  const refs = new Map<string, VcsListRefsResult>();
  const key = (environmentId: EnvironmentId, cwd: string) => `${environmentId}\u0000${cwd}`;
  return {
    loadServerConfig: (environmentId) => Effect.sync(() => Option.fromNullishOr(configs.get(environmentId))),
    saveServerConfig: (environmentId, config) => Effect.sync(() => void configs.set(environmentId, config)),
    loadVcsRefs: (environmentId, cwd) => Effect.sync(() => Option.fromNullishOr(refs.get(key(environmentId, cwd)))),
    saveVcsRefs: (environmentId, cwd, value) => Effect.sync(() => void refs.set(key(environmentId, cwd), value)),
    removeVcsRefs: (environmentId, cwd) => Effect.sync(() => void refs.delete(key(environmentId, cwd))),
    clearVcsRefs: (environmentId) =>
      Effect.sync(() => {
        for (const stored of [...refs.keys()]) if (stored.startsWith(`${environmentId}\u0000`)) refs.delete(stored);
      }),
    clear: (environmentId) =>
      Effect.sync(() => {
        configs.delete(environmentId);
        for (const stored of [...refs.keys()]) if (stored.startsWith(`${environmentId}\u0000`)) refs.delete(stored);
      }),
  };
});
