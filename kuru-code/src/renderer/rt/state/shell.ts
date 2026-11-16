// T3 Code's client-runtime state/shell.ts, as a barrel of its pure parts. Its
// shell subscription (snapshots and streams from a server) has no place in
// kuru code, whose shells are built from Unharnessed's sessions (kuru/shells.ts).
import type { OrchestrationV2ShellSnapshot, ThreadId } from "~/contracts";
import * as Option from "effect/Option";

export type EnvironmentShellStatus = "empty" | "cached" | "synchronizing" | "live";

export interface EnvironmentShellState {
  readonly snapshot: Option.Option<OrchestrationV2ShellSnapshot>;
  readonly status: EnvironmentShellStatus;
  readonly error: Option.Option<string>;
  readonly generation: number;
  readonly removedAt: ReadonlyMap<ThreadId, number>;
}

export const EMPTY_SHELL_STATE: EnvironmentShellState = {
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
  generation: 0,
  removedAt: new Map(),
};

export * from "./models";
export * from "./shellReducer";
export * from "./shellPullRequests";
