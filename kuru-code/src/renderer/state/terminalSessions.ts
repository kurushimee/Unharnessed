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
