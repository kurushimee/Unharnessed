// T3 Code's client-runtime state/threads.ts, as a barrel of its pure parts. Its
// thread state machine (snapshots, streams, history pages from a server) has
// no place in kuru code: a thread's projection is built from Unharnessed's
// session (kuru/projection.ts, kuru/threadDetails.ts).
export * from "./archivedThreads";
export * from "./checkpointDiff";
export type { ThreadHistoryLoadEarlierResult } from "~/state/threads";
export * from "./threadHistoryMerge";
export * from "./composerPathSearch";
export * from "./threadFeedback";
export * from "./threadDetail";
export * from "./threadState";
export * from "./threadTagFilter";

// From T3 Code's client-runtime state/threadShell.ts.
import type { EnvironmentThreadShell } from "./models";
export function childThreadInputsTitle(
  children: ReadonlyArray<Pick<EnvironmentThreadShell, "hasPendingApprovals" | "lineage">>,
): string {
  const approvals = children.filter((child) => child.hasPendingApprovals).length;
  const need = approvals === 0 ? "input" : approvals === children.length ? "approval" : "you";
  const sideChats = children.filter((child) => child.lineage.sideChat === true).length;
  const noun =
    sideChats === children.length ? "side chat" : sideChats === 0 ? "subagent" : "thread";
  return children.length === 1
    ? `${noun === "side chat" ? "Side chat" : "Subagent"} needs ${need}`
    : `${children.length} ${noun}s need ${need}`;
}
