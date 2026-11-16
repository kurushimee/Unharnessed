// T3 Code's state/session.ts scopes: what this client may do in an environment.
// kuru code's one environment is this computer, where it may do everything.
import { LOCAL_ENVIRONMENT_ID, type EnvironmentId } from "~/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { AuthEnvironmentScope, type SessionGrantInput } from "~/contracts";

export const AuthOrchestrationOperateScope = "orchestration:operate" as const;
/** Any of T3 Code's auth scopes (contracts/auth.ts). */
export type EnvironmentScope = string;

export function readEnvironmentScope(_environmentId: EnvironmentId, _scope: EnvironmentScope): boolean {
  return true;
}

export function useEnvironmentScope(_environmentId: EnvironmentId | null, _scope: EnvironmentScope): boolean {
  return true;
}

/**
 * T3 Code's prepared connection to an environment: where its HTTP API is.
 * kuru code's environment is its main process: its files come as kuru-asset:
 * URLs it serves (src/main/assets.ts), which T3 Code's relative asset URLs
 * resolve against.
 */
export interface PreparedConnection {
  readonly httpBaseUrl: string;
  readonly target: null;
}

export const LOCAL_ASSET_BASE_URL = "kuru-asset://local/";
const LOCAL_CONNECTION: PreparedConnection = { httpBaseUrl: LOCAL_ASSET_BASE_URL, target: null };
const SOME_LOCAL_CONNECTION = Option.some(LOCAL_CONNECTION);

export function readPreparedConnection(environmentId: EnvironmentId): PreparedConnection | null {
  return environmentId === LOCAL_ENVIRONMENT_ID ? LOCAL_CONNECTION : null;
}

export function usePreparedConnection(environmentId: EnvironmentId | null): Option.Option<PreparedConnection> {
  return environmentId === LOCAL_ENVIRONMENT_ID ? SOME_LOCAL_CONNECTION : Option.none();
}

/** T3 Code's auth session state: kuru code's window holds every scope of its own machine. */
const FULL_SESSION = Atom.make(
  AsyncResult.success<SessionGrantInput, never>({ authenticated: true, scopes: AuthEnvironmentScope.literals }),
);
export const environmentSession = {
  sessionStateAtom: (_environmentId: EnvironmentId) => FULL_SESSION,
};

export function sessionHasScope(_result: unknown, _scope: EnvironmentScope): boolean {
  return true;
}

export function useEnvironmentsWithScope(
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId }>,
  _scope: EnvironmentScope,
): ReadonlySet<EnvironmentId> {
  return new Set(environments.map(({ environmentId }) => environmentId));
}

export function useEnvironmentSessionState(_environmentId: EnvironmentId | null) {
  return FULL_SESSION_VALUE;
}
const FULL_SESSION_VALUE = AsyncResult.success<SessionGrantInput, never>({
  authenticated: true,
  scopes: AuthEnvironmentScope.literals,
});

/** One full session per environment id in the key (newline-separated, T3 Code's environmentIdsKey). */
export const environmentSessionStatesAtom = Atom.family((key: string) =>
  Atom.make((): ReadonlyArray<AsyncResult.AsyncResult<SessionGrantInput, never>> =>
    key === "" ? [] : key.split("\n").map(() => FULL_SESSION_VALUE),
  ),
);
