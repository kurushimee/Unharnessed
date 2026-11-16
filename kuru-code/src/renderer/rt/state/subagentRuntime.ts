import * as DateTime from "effect/DateTime";
import type { OrchestrationV2TurnItem } from "~/contracts";
import { isOrchestrationV2WorkActive } from "~/contracts";

export type RuntimeSubagentStatus =
  | "pending"
  | "running"
  | "waiting"
  | "idle"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface SubagentUsage {
  readonly totalTokens: number;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly toolUses?: number;
  readonly durationMs?: number;
}

export interface SubagentActivityEntry {
  readonly at: string;
  readonly summary: string;
}

export interface SubagentWorkflowPhase {
  readonly index: number;
  readonly title: string;
}

export interface SubagentRunHandles {
  readonly runId?: string | undefined;
  readonly scriptPath?: string | undefined;
  readonly transcriptDir?: string | undefined;
  readonly sessionUrl?: string | undefined;
}

export interface RuntimeSubagent {
  readonly id: string;
  readonly kind: "subagent" | "subagent_batch" | "workflow" | "workflow_agent";
  readonly title: string;
  readonly role: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly speed?: string | undefined;
  readonly status: RuntimeSubagentStatus;
  readonly activationCount: number;
  readonly usage: SubagentUsage | null;
  readonly progress: string | null;
  readonly lastToolName: string | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly outputFile: string | null;
  readonly parentAgentId: string | null;
  readonly agentIndex: number | null;
  readonly phaseIndex: number | null;
  readonly phaseTitle: string | null;
  readonly attempt: number | null;
  readonly workflowName: string | null;
  readonly phases: ReadonlyArray<SubagentWorkflowPhase>;
  readonly runHandles: SubagentRunHandles | null;
  readonly childThreadId: string | null;
  readonly recentActivity: ReadonlyArray<SubagentActivityEntry>;
  readonly firstSeenAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly updatedAt: string;
}

const TERMINAL_STATUSES: ReadonlySet<RuntimeSubagentStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export function isTerminalSubagentStatus(status: RuntimeSubagentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isActiveSubagentStatus(status: RuntimeSubagentStatus): boolean {
  return isOrchestrationV2WorkActive(status);
}

export function isLiveSubagentTurnItem(item: OrchestrationV2TurnItem): boolean {
  return item.type === "subagent" && isOrchestrationV2WorkActive(item.status);
}

function workflowUsage(source: {
  readonly totalTokens?: number | undefined;
  readonly toolCalls?: number | undefined;
  readonly durationMs?: number | undefined;
}): SubagentUsage | null {
  if (source.totalTokens === undefined) return null;
  return {
    totalTokens: source.totalTokens,
    ...(source.toolCalls === undefined ? {} : { toolUses: source.toolCalls }),
    ...(source.durationMs === undefined ? {} : { durationMs: source.durationMs }),
  };
}

function isoFromEpochMillis(value: number | undefined): string | null {
  return value === undefined ? null : DateTime.formatIso(DateTime.makeUnsafe(value));
}

