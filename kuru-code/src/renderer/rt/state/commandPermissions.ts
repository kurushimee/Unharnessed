// T3 Code's command permissions: what a connection's session may do, by the
// scopes its RPCs require. kuru code's window is the machine's own app, its
// one session granted everything, so every command is permitted.
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/reactivity";
import type { EnvironmentAuthorizationError, EnvironmentId } from "~/contracts";

const PERMITTED = Atom.make(true);

export function createCommandPermissions(_runtime: unknown, _method: string) {
  return {
    requiredScopes: (_input?: unknown): ReadonlyArray<string> => [],
    permissionAtom: (_environmentId: EnvironmentId | null, _input?: unknown): Atom.Atom<boolean> => PERMITTED,
    authorize: (
      _registry: AtomRegistry.AtomRegistry,
      _environmentId: EnvironmentId,
      _input?: unknown,
    ): Effect.Effect<void, EnvironmentAuthorizationError> => Effect.void,
  };
}
