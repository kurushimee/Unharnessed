// T3 Code's state/session.ts scopes: what this client may do in an environment.
// kuru code's one environment is this computer, where it may do everything.
import type { EnvironmentId } from "~/contracts";

export const AuthOrchestrationOperateScope = "orchestration:operate" as const;
export type EnvironmentScope = typeof AuthOrchestrationOperateScope;

export function readEnvironmentScope(_environmentId: EnvironmentId, _scope: EnvironmentScope): boolean {
  return true;
}

export function useEnvironmentScope(_environmentId: EnvironmentId | null, _scope: EnvironmentScope): boolean {
  return true;
}
