// T3 Code's connection runtime: the services its environment atoms run with.
// T3 Code's connects to its servers; kuru code's registry holds its one
// environment, its main process (rt/connection/registry.ts), and caches in
// the window's memory (rt/platform/persistence.ts).
import * as Layer from "effect/Layer";
import { Atom } from "effect/reactivity";
import * as EnvironmentRegistry from "~/rt/connection/registry";
import { layerMemoryCache } from "~/rt/platform/persistence";
import { LOCAL_CONNECTION_ENTRY, LOCAL_PREPARED_CONNECTION } from "~/kuru/environment";

export const connectionAtomRuntime = Atom.runtime(
  Layer.mergeAll(
    EnvironmentRegistry.layerLocal(LOCAL_CONNECTION_ENTRY, LOCAL_PREPARED_CONNECTION),
    layerMemoryCache,
  ),
);
