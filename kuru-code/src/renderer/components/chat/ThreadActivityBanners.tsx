import type {
  EnvironmentId,
  OrchestrationV2PendingBackgroundTask,
  OrchestrationV2ProviderGoal,
  OrchestrationV2ProviderSession,
  ThreadId,
} from "~/contracts";
import type { ThreadStructure } from "~/rt/state/models";
import {
  presentPendingBackgroundWork,
  presentProviderGoal,
  type RunStopPresentation,
} from "~/rt/state/threadExecution";
import { commandDisplayText } from "~/rt/work-log/commandLabel";
import { formatDuration } from "~/shared/orchestrationTiming";
import * as DateTime from "effect/DateTime";
import {
  CircleDashedIcon,
  CircleStopIcon,
  GitBranchIcon,
  TargetIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Fragment } from "react";
import { tickTextContent } from "~/lib/tickTextContent";
import { BackgroundWorkDetails } from "./BackgroundWorkDetails";
import { Button, InlineButton } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import type { ThreadNowItem } from "./ThreadNow";

export function extensionStatusBannerItem(
  statuses: NonNullable<OrchestrationV2ProviderSession["extensionStatuses"]>,
): ComposerBannerStackItem | null {
  if (statuses.length === 0) return null;
  return {
    id: "pi-extension-status",
    variant: "default",
    icon: <span>▸</span>,
    title: <output>{`Pi · ${statuses.map((status) => status.text).join(" · ")}`}</output>,
  };
}

/** The thread's goal, for the end of the timeline. */
export function goalNowItem(input: {
  readonly threadId: ThreadId;
  readonly goal: OrchestrationV2ProviderGoal;
  readonly isWorking: boolean;
  readonly onSendCommand: (text: string, failureMessage: string) => Promise<void>;
}): ThreadNowItem {
  const { isWorking, onSendCommand } = input;
  const presentation = presentProviderGoal(input.goal, isWorking);
  return {
    id: `goal:${input.threadId}`,
    icon: <TargetIcon />,
    title:
      presentation.usage === null
        ? presentation.title
        : `${presentation.title} · ${presentation.usage}`,
    description: presentation.objective,
    // Clear stops goal work; Resume would stop unrelated work, so it waits.
    actions: (
      <>
        {presentation.canResume && !isWorking ? (
          <>
            <InlineButton
              onClick={() => void onSendCommand("/goal resume", "Failed to resume goal.")}
            >
              Resume
            </InlineButton>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <InlineButton
          tone="muted"
          onClick={() => void onSendCommand("/goal clear", "Failed to clear goal.")}
        >
          Clear
        </InlineButton>
      </>
    ),
  };
}

/** A Stop the provider has not finished; Force stop once it stops answering. */
export function runStopNowItem(input: {
  readonly threadId: ThreadId;
  readonly stop: RunStopPresentation;
}): ThreadNowItem {
  const unresponsive = input.stop.state === "unresponsive";
  const requestedAtMs = Date.parse(input.stop.requestedAt);
  return {
    id: `run-stop:${input.threadId}`,
    icon: unresponsive ? (
      <TriangleAlertIcon className="text-warning-foreground" />
    ) : (
      <CircleStopIcon />
    ),
    title: unresponsive ? "Agent not responding to Stop" : "Stopping",
    actions: (
      <span
        ref={tickTextContent(
          (nowMs) => formatDuration(Math.max(1_000, nowMs - requestedAtMs)),
          true,
        )}
        className="tabular-nums"
      />
    ),
  };
}

/** Background commands and subagents, for the end of the timeline. */
export function backgroundWorkNowItem(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>;
  readonly turnItems: ThreadStructure["turnItems"];
  readonly stopDisabled: boolean;
  readonly stopping: boolean;
  readonly onStop: () => Promise<void>;
}): ThreadNowItem | null {
  const presentation = presentPendingBackgroundWork(input.tasks);
  if (presentation === null) return null;
  const rows = presentation.items.map((task) => {
    // Same key derivePendingBackgroundWork gives turn-item tasks; subagent items carry progress.
    const item = input.turnItems.findLast(
      (candidate) => (candidate.nativeItemRef?.nativeId || candidate.id) === task.taskId,
    );
    const subagent = item?.type === "subagent" ? item : undefined;
    return {
      task,
      label:
        item?.type === "command_execution" && commandDisplayText(item.input) === task.label ? (
          <span className="font-mono in-data-[slot=popover-popup]:whitespace-pre-wrap">
            {task.label}
          </span>
        ) : task.label.includes("\n") ? (
          <span className="in-data-[slot=popover-popup]:whitespace-pre-wrap">{task.label}</span>
        ) : (
          task.label
        ),
      activity: subagent?.progress?.replace(/\s+/gu, " ").trim() || null,
      startedAtMs: item?.startedAt ? DateTime.toEpochMillis(item.startedAt) : null,
      updatedAtMs: subagent ? DateTime.toEpochMillis(subagent.updatedAt) : 0,
    };
  });
  const [only] = rows.length === 1 ? rows : [];
  const newest = rows
    .filter((row) => row.activity)
    .toSorted((left, right) => right.updatedAtMs - left.updatedAtMs)[0];
  const isCommand = (row: (typeof rows)[number]) => row.task.kind !== "subagent";
  const startedAtMs = only?.startedAtMs ?? null;
  return {
    id: `background-work:${input.threadId}`,
    icon: rows.every(isCommand) ? <TerminalIcon /> : <CircleDashedIcon />,
    title:
      only && typeof only.label !== "string" && only.task.label !== only.task.kind ? (
        <>
          {presentation.waiting ? "Waiting" : "Running"} · {only.label}
        </>
      ) : (
        presentation.title
      ),
    description: only ? (
      only.activity
    ) : newest ? (
      <>
        {newest.label}: {newest.activity}
      </>
    ) : (
      rows.map((row, index) => (
        <Fragment key={row.task.taskId}>
          {index > 0 ? ", " : null}
          {row.label}
        </Fragment>
      ))
    ),
    actions: (
      <>
        {startedAtMs === null ? null : (
          <span
            ref={tickTextContent(
              (nowMs) => formatDuration(Math.max(1_000, nowMs - startedAtMs)),
              true,
            )}
            className="tabular-nums"
          />
        )}
        <BackgroundWorkDetails
          environmentId={input.environmentId}
          threadId={input.threadId}
          tasks={input.tasks}
          turnItems={input.turnItems}
        />
        <InlineButton disabled={input.stopDisabled} onClick={() => void input.onStop()}>
          {input.stopping ? "Stopping..." : "Stop"}
        </InlineButton>
      </>
    ),
  };
}

/** The local checkout moved off the branch this thread last ran on. */
export function branchMismatchBannerItem(input: {
  readonly mismatchKey: string;
  readonly mismatch: { readonly threadBranch: string; readonly currentBranch: string };
  readonly restoreDisabled: boolean;
  readonly restoring: boolean;
  readonly onRestore: () => void;
  readonly onDismiss: () => void;
}): ComposerBannerStackItem {
  const { mismatch } = input;
  return {
    id: `branch-mismatch:${input.mismatchKey}`,
    variant: "info",
    icon: <GitBranchIcon />,
    title: (
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 font-normal text-muted-foreground">Branch changed from</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <code className="min-w-0 truncate font-medium text-foreground">
                {mismatch.threadBranch}
              </code>
            }
          />
          <TooltipPopup side="top">
            This thread last ran on {mismatch.threadBranch}. Sending will continue on{" "}
            {mismatch.currentBranch}.
          </TooltipPopup>
        </Tooltip>
      </span>
    ),
    actions: (
      <Button size="xs" variant="ghost" disabled={input.restoreDisabled} onClick={input.onRestore}>
        {input.restoring ? "Restoring..." : "Restore branch"}
      </Button>
    ),
    dismissLabel: "Dismiss branch change notice",
    onDismiss: input.onDismiss,
  };
}
