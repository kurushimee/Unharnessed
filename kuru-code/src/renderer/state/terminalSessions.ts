// T3 Code's state/terminalSessions.ts: the terminals running in a thread.
// kuru code has no thread terminals (the agent runs its own commands), so a
// thread never has one running.
import type { EnvironmentId, ThreadId } from "~/contracts";

const NONE: ReadonlyArray<string> = [];

export function useThreadRunningTerminalIds(_thread: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}): ReadonlyArray<string> {
  return NONE;
}

export interface KnownTerminalSession {
  readonly target: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId; readonly terminalId: string };
  readonly state: unknown;
}
const NO_SESSIONS: ReadonlyArray<KnownTerminalSession> = [];

export function useKnownTerminalSessions(_input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}): ReadonlyArray<KnownTerminalSession> | null {
  return NO_SESSIONS;
}
