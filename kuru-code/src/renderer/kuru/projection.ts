// The seam between Unharnessed and T3 Code's thread view. T3 Code's server
// keeps each thread as an orchestration projection (runs, messages, turn
// items) that its timeline reads; kuru code's main process keeps an
// Unharnessed conversation as the VS Code extension's chat (turns of
// reasoning, text, tool calls, compactions, notices). This builds the first
// from the second, so T3 Code's timeline shows an Unharnessed thread
// unchanged: a turn is a run, its prompt a user message, its text an
// assistant message, its thought reasoning, and each tool call the turn item
// T3 Code has for what the call did (a command, a file change, a search, a
// read, or the call itself).
//
// An item that did not change keeps its projected item, so T3 Code's
// memoized rows render only what changed while a reply streams.
import {
  ChatAttachmentId,
  MessageId,
  ProviderInstanceId,
  RunId,
  TurnItemId,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  type OrchestrationV2ProjectedTurnItem,
  type ProjectId,
  type ThreadId,
} from "~/contracts";
import type { ChatEntry, ChatState, DiffLine, TurnHead, TurnItem } from "@shared/protocol";
import * as DateTime from "effect/DateTime";

import { rootThreadLineage } from "~/rt/state/models";

type Turn = TurnHead & { items: TurnItem[] };
type Tool = Extract<TurnItem, { kind: "tool" }>;
type Item = OrchestrationV2TurnItem;

/** What a thread's projection is built from, beside its conversation. */
export interface ThreadProjectionSource {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly branch: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const WAKES: Record<NonNullable<TurnHead["wake"]>, string> = {
  bash: "A background command ended",
  quota: "A usage limit reset",
  goal: "The goal's pause ended",
};

const utc = (ms: number) => DateTime.makeUnsafe(ms);

/**
 * The prompts the window sent each thread, oldest first, by the message id its timeline shows
 * them under until the conversation has them. A new turn with that prompt takes the id, so
 * T3 Code's timeline replaces its own copy with the turn's.
 */
const sentPrompts = new Map<ThreadId, Array<{ readonly messageId: MessageId; readonly text: string }>>();

export function notePromptSent(threadId: ThreadId, messageId: MessageId, text: string): void {
  const sent = sentPrompts.get(threadId) ?? [];
  sent.push({ messageId, text });
  sentPrompts.set(threadId, sent);
}

/** A send the main process refused: its prompt never becomes a turn. */
export function forgetPromptSent(threadId: ThreadId, messageId: MessageId): void {
  const sent = sentPrompts.get(threadId)?.filter((prompt) => prompt.messageId !== messageId);
  if (sent && sent.length > 0) sentPrompts.set(threadId, sent);
  else sentPrompts.delete(threadId);
}

/** The id the window sent `text` under, for a turn the agent just took. */
function takeSentPrompt(threadId: ThreadId, text: string): MessageId | null {
  const sent = sentPrompts.get(threadId);
  const head = sent?.[0];
  // The agent names a skill `/skill:name` where the window sent `/name`.
  if (!sent || !head || (head.text.trim() !== text.trim() && !(head.text.startsWith("/") && text.startsWith("/")))) {
    return null;
  }
  sent.shift();
  if (sent.length === 0) sentPrompts.delete(threadId);
  return head.messageId;
}

/** The run of a turn, as T3 Code names its states. */
function runStatus(turn: TurnHead): OrchestrationV2Run["status"] {
  switch (turn.state) {
    case "running":
      return "running";
    case "done":
      return "completed";
    case "cancelled":
      return "interrupted";
    case "failed":
      return "failed";
  }
}

/** A unified diff of a cell's changed lines, for T3 Code's file change row. */
function unifiedDiff(path: string, lines: ReadonlyArray<DiffLine>): string {
  const body = lines.map(([mark, text]) => (mark === "…" ? "@@" : `${mark}${text}`));
  return [`--- a/${path}`, `+++ b/${path}`, "@@", ...body].join("\n");
}

/** The turn item T3 Code has for what an Unharnessed tool call did. */
/** A tool call; one still running when its turn ended was cut off with it (an agent that quit). */
function toolItem(tool: Tool, base: ItemBase, turnRunning: boolean): Item {
  const status: Item["status"] =
    tool.status === "running"
      ? turnRunning
        ? "running"
        : "interrupted"
      : tool.status === "failed"
        ? "failed"
        : "completed";
  const common = { ...base, status, title: null };
  const cell = tool.cell;
  const output = tool.output;
  if (cell === undefined) {
    let input: unknown = tool.input;
    try {
      input = JSON.parse(tool.input);
    } catch {}
    return {
      ...common,
      type: "dynamic_tool",
      toolName: tool.title.trim() || null,
      input,
      ...(output !== undefined ? { output } : {}),
    };
  }
  switch (cell.kind) {
    case "shell":
      return {
        ...common,
        type: "command_execution",
        input: cell.command ?? tool.input,
        ...(output !== undefined ? { output } : {}),
        ...(tool.status === "failed" ? { outputIndicatesFailure: true } : {}),
      };
    case "edit":
    case "write": {
      const [first = "file"] = cell.files;
      return {
        ...common,
        type: "file_change",
        fileName: first,
        ...(cell.diff
          ? {
              additions: cell.diff.added,
              deletions: cell.diff.removed,
              diffStr: unifiedDiff(first, cell.diff.lines),
            }
          : {}),
        ...(cell.files.length > 1
          ? {
              changes: cell.files.map((path) => ({
                operation: cell.kind === "write" ? "write" : "edit",
                path,
              })),
            }
          : {}),
      };
    }
    case "search":
      return {
        ...common,
        type: "file_search",
        ...(cell.command ? { pattern: cell.command } : {}),
      };
    case "read":
    case "view":
      return {
        ...common,
        type: "dynamic_tool",
        toolName: "Read",
        ...(cell.kind === "view" && cell.files[0] ? { viewedImagePath: cell.files[0] } : {}),
        input: { path: cell.files[0] ?? "", code: tool.input },
        ...(output !== undefined ? { output } : {}),
      };
    case "python":
      return {
        ...common,
        type: "dynamic_tool",
        toolName: "Python",
        input: { code: tool.input },
        ...(output !== undefined ? { output } : {}),
      };
  }
}

type UserMessageItem = Extract<Item, { readonly type: "user_message" }>;
/** The fields every turn item has (T3 Code's OrchestrationV2TurnItemBaseFields). */
type ItemBase = Pick<
  UserMessageItem,
  | "id"
  | "threadId"
  | "runId"
  | "nodeId"
  | "providerThreadId"
  | "providerTurnId"
  | "nativeItemRef"
  | "parentItemId"
  | "ordinal"
  | "startedAt"
  | "completedAt"
  | "updatedAt"
>;

interface TurnProjection {
  readonly run: OrchestrationV2Run;
  readonly items: ReadonlyArray<Item>;
}

/** A waiting message's image, by its position in the message. */
export function queuedAttachmentId(threadId: string, queuedId: number, position: number): string {
  return `${threadId}:queued:${queuedId}:${position}`;
}

/**
 * Projects conversations. Kept per thread: an Unharnessed item that is the
 * same object as before (the chat's patches keep what did not change) keeps
 * its projected item.
 */
export class ThreadProjector {
  private items = new WeakMap<TurnItem, { key: string; item: Item }>();
  private rows = new WeakMap<Item, OrchestrationV2ProjectedTurnItem>();
  /** Turns' prompts by the id the window sent them under. */
  private promptIds = new Map<number, MessageId>();
  /** The turns the agent can go back to before, by their prompt's message: this projection's. */
  private rewindable = new Map<MessageId, number>();
  /** Their messages, the same set while they stay the same. */
  rewindableMessageIds: ReadonlySet<MessageId> = new Set();
  private last: { chat: ChatState; source: ThreadProjectionSource; projection: OrchestrationV2ThreadProjection } | null =
    null;

  /** The turn whose prompt is `messageId`, when the agent can go back to before it. */
  rewindableTurn(messageId: string): number | undefined {
    return this.rewindable.get(messageId as MessageId);
  }

  project(chat: ChatState, source: ThreadProjectionSource): OrchestrationV2ThreadProjection {
    if (this.last?.chat === chat && this.last.source === source) return this.last.projection;
    const threadId = source.threadId;
    this.rewindable = new Map();
    const instanceId = ProviderInstanceId.make(source.provider || "unharnessed");
    const modelSelection = { instanceId, model: source.model || "unknown" };
    const runs: OrchestrationV2Run[] = [];
    const messages: OrchestrationV2ThreadProjection["messages"][number][] = [];
    const turnItems: Item[] = [];
    let ordinal = 0;
    // A turn with no time of its own is placed just after the one before it.
    let clock = source.createdAt;

    for (const entry of chat.entries) {
      if (entry.kind !== "turn") {
        const at = utc(entry.kind === "kernel" ? entry.at : clock);
        turnItems.push(
          this.cached(entry, `${entry.kind}`, () => ({
            ...this.base(threadId, `line:${entry.id}`, null, ordinal, at, at),
            type: "system_notice",
            status: "completed",
            title: null,
            message: lineText(entry),
          })),
        );
        ordinal += 1;
        continue;
      }
      const began = entry.at ?? clock + 1;
      clock = began + (entry.ms ?? 0);
      const projected = this.turn(entry, threadId, began, ordinal, modelSelection, instanceId);
      ordinal += projected.items.length;
      runs.push(projected.run);
      turnItems.push(...projected.items);
      for (const item of projected.items) {
        if (item.type === "user_message" || item.type === "assistant_message") {
          messages.push({
            id: item.messageId,
            threadId,
            runId: item.runId,
            nodeId: null,
            role: item.type === "user_message" ? "user" : "assistant",
            text: item.text,
            attachments: item.attachments ?? [],
            streaming: item.type === "assistant_message" && item.streaming,
            createdBy: item.type === "user_message" ? "user" : "agent",
            creationSource: item.type === "user_message" ? "web" : "provider",
            createdAt: item.startedAt ?? item.updatedAt,
            updatedAt: item.updatedAt,
          });
        }
      }
    }

    // Messages waiting for the running turn to end (or held while changed): T3 Code's queued runs.
    const queuedAt = utc(clock);
    // Those already sent into the running turn show as T3 Code's steer rows instead.
    chat.queue.filter((queued) => queued.state !== "steering").forEach((queued, index) => {
      const runId = RunId.make(`${threadId}:queued-${queued.id}`);
      // The id the window sent it under, which its turn keeps once it starts.
      if (!this.promptIds.has(queued.id)) {
        const sent = takeSentPrompt(threadId, queued.text);
        if (sent !== null) this.promptIds.set(queued.id, sent);
      }
      const messageId = this.promptIds.get(queued.id) ?? MessageId.make(`${threadId}:queued:${queued.id}`);
      runs.push({
        id: runId,
        threadId,
        ordinal: queued.id,
        providerInstanceId: instanceId,
        modelSelection,
        providerThreadId: null,
        userMessageId: messageId,
        rootNodeId: null,
        activeAttemptId: null,
        status: "queued",
        queuePosition: index + 1,
        queueHeld: chat.paused,
        requestedAt: queuedAt,
        startedAt: null,
        completedAt: null,
        checkpointId: null,
        contextHandoffId: null,
      });
      messages.push({
        id: messageId,
        threadId,
        runId,
        nodeId: null,
        role: "user",
        text: queued.text,
        attachments: queued.images.map((image, position) => ({
          type: "image" as const,
          id: ChatAttachmentId.make(queuedAttachmentId(threadId, queued.id, position)),
          name: image.name || "image",
          mimeType: mimeOf(image.thumb),
          sizeBytes: 0,
        })),
        streaming: false,
        createdBy: "user",
        creationSource: "web",
        createdAt: queuedAt,
        updatedAt: queuedAt,
      });
    });

    const visibleTurnItems = turnItems.map((item, position) => this.row(item, position, threadId));
    const createdAt = utc(source.createdAt);
    const updatedAt = utc(Math.max(source.updatedAt, clock));
    const latest = runs.at(-1);
    const projection: OrchestrationV2ThreadProjection = {
      thread: {
        id: threadId,
        projectId: source.projectId,
        title: source.title,
        providerInstanceId: instanceId,
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: source.branch,
        worktreePath: null,
        activeProviderThreadId: null,
        lineage: rootThreadLineage(threadId),
        forkedFrom: null,
        createdBy: "user",
        creationSource: "web",
        createdAt,
        updatedAt,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      },
      runs,
      attempts: [],
      nodes: [],
      subagents: [],
      providerSessions: [],
      providerThreads: [],
      providerTurns: [],
      runtimeRequests: [],
      messages,
      plans: [],
      turnItems,
      checkpointScopes: [],
      checkpoints: [],
      contextHandoffs: [],
      contextTransfers: [],
      visibleTurnItems,
      updatedAt: latest?.completedAt ?? updatedAt,
    };
    const ids = this.rewindableMessageIds;
    if (ids.size !== this.rewindable.size || [...this.rewindable.keys()].some((id) => !ids.has(id))) {
      this.rewindableMessageIds = new Set(this.rewindable.keys());
    }
    this.last = { chat, source, projection };
    return projection;
  }

  private turn(
    turn: Turn,
    threadId: ThreadId,
    began: number,
    firstOrdinal: number,
    modelSelection: OrchestrationV2Run["modelSelection"],
    instanceId: ProviderInstanceId,
  ): TurnProjection {
    const runId = RunId.make(`${threadId}:turn:${turn.id}`);
    const running = turn.state === "running";
    const ended = turn.ms === undefined ? null : began + turn.ms;
    const items: Item[] = [];
    let ordinal = firstOrdinal;
    if (turn.prompt && running && !this.promptIds.has(turn.id)) {
      const sent = takeSentPrompt(threadId, turn.prompt.text);
      if (sent !== null) this.promptIds.set(turn.id, sent);
    }
    const userMessageId = this.promptIds.get(turn.id) ?? MessageId.make(`${threadId}:prompt:${turn.id}`);
    if (turn.rewindTo !== undefined) this.rewindable.set(userMessageId, turn.id);
    const at = utc(began);

    if (turn.prompt) {
      const prompt = turn.prompt;
      items.push(
        this.cached(prompt, `prompt:${userMessageId}`, () => ({
          ...this.base(threadId, `prompt:${turn.id}`, runId, ordinal, at, at),
          type: "user_message",
          messageId: userMessageId,
          status: "completed",
          title: null,
          createdBy: "user",
          creationSource: "web",
          inputIntent: "turn_start",
          text: prompt.text,
          attachments: prompt.images.map((image, index) => ({
            type: "image" as const,
            id: ChatAttachmentId.make(`${threadId}:prompt:${turn.id}:${index}`),
            name: image.name || "image",
            mimeType: mimeOf(image.thumb),
            sizeBytes: 0,
          })),
        })),
      );
      ordinal += 1;
    } else if (turn.wake) {
      const wake = turn.wake;
      items.push(
        this.cached(turn, `wake:${wake}`, () => ({
          ...this.base(threadId, `wake:${turn.id}`, runId, ordinal, at, at),
          type: "system_notice",
          status: "completed",
          title: null,
          message: WAKES[wake],
        })),
      );
      ordinal += 1;
    }

    const lastIndex = turn.items.length - 1;
    turn.items.forEach((source, index) => {
      // Only the turn's last item can still be growing; once the turn is done, it ends when the
      // turn did, which is how T3 Code's timeline times a turn that is not the latest.
      const live = running && index === lastIndex;
      const closing = !running && index === lastIndex && ended !== null ? utc(ended) : null;
      const key = closing === null ? `${live}:${running}` : `ended:${ended}`;
      const id = `turn:${turn.id}:${index}`;
      const project = (): Item => {
        switch (source.kind) {
          case "thought": {
            const start = utc(source.started);
            const done = source.ms === undefined ? null : utc(source.started + source.ms);
            return {
              ...this.base(threadId, id, runId, ordinal, start, done ?? start),
              completedAt: done,
              type: "reasoning",
              status: done === null && running ? "running" : "completed",
              title: null,
              text: source.text,
              streaming: done === null && running,
            };
          }
          case "text":
            return {
              ...this.base(threadId, id, runId, ordinal, at, at),
              type: "assistant_message",
              messageId: MessageId.make(`${threadId}:${id}`),
              status: live ? "running" : "completed",
              title: null,
              text: source.text,
              streaming: live,
            };
          case "tool":
            return toolItem(source, this.base(threadId, id, runId, ordinal, at, at), running);
          case "compaction":
            return {
              ...this.base(threadId, id, runId, ordinal, at, at),
              type: "compaction",
              status: source.state === "running" ? "running" : "completed",
              title: null,
              driver: null,
              ...(source.summary ? { summary: source.summary } : {}),
              ...(source.tokensBefore !== undefined ? { beforeTokenCount: source.tokensBefore } : {}),
            };
          case "notice":
            return source.tone === "error"
              ? {
                  ...this.base(threadId, id, runId, ordinal, at, at),
                  type: "error",
                  status: "completed",
                  title: null,
                  failure: { class: "unknown", message: source.text || "Error", code: null, retryable: null },
                }
              : {
                  ...this.base(threadId, id, runId, ordinal, at, at),
                  type: "system_notice",
                  status: "completed",
                  title: null,
                  message: source.text,
                };
        }
      };
      const item = this.cached(source, key, () => {
        const projected = project();
        return closing === null ? projected : { ...projected, completedAt: closing, updatedAt: closing };
      });
      items.push(item);
      ordinal += 1;
    });

    if (turn.state === "failed") {
      const error = turn.error;
      items.push(
        this.cached(turn, `failed:${error}`, () => ({
          ...this.base(threadId, `turn:${turn.id}:failed`, runId, ordinal, utc(ended ?? began), utc(ended ?? began)),
          type: "error",
          status: "completed",
          title: null,
          failure: {
            class: /usage limit|rate limit|quota/i.test(error ?? "") ? "usage_limit" : "provider_error",
            message: (error ?? "The turn failed.").slice(0, 4000) || "The turn failed.",
            code: null,
            retryable: null,
          },
        })),
      );
      ordinal += 1;
    } else if (turn.state === "cancelled") {
      items.push(
        this.cached(turn, "cancelled", () => ({
          ...this.base(threadId, `turn:${turn.id}:stopped`, runId, ordinal, utc(ended ?? began), utc(ended ?? began)),
          type: "run_interrupt_result",
          status: "completed",
          title: null,
          message: "Stopped",
        })),
      );
      ordinal += 1;
    }

    const run: OrchestrationV2Run = {
      id: runId,
      threadId,
      ordinal: turn.id,
      providerInstanceId: instanceId,
      modelSelection,
      providerThreadId: null,
      userMessageId,
      rootNodeId: null,
      activeAttemptId: null,
      status: runStatus(turn),
      requestedAt: at,
      startedAt: at,
      completedAt: running ? null : utc(ended ?? began),
      checkpointId: null,
      contextHandoffId: null,
    };
    return { run, items };
  }

  private base(
    threadId: ThreadId,
    id: string,
    runId: RunId | null,
    ordinal: number,
    startedAt: DateTime.Utc,
    updatedAt: DateTime.Utc,
  ): ItemBase {
    return {
      id: TurnItemId.make(`${threadId}:${id}`),
      threadId,
      runId,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal,
      startedAt,
      completedAt: startedAt,
      updatedAt,
    };
  }

  /** The item projected from `source` before, if its key is the same; else a new one. */
  private cached(source: object, key: string, make: () => Item): Item {
    const known = this.items.get(source as TurnItem);
    if (known?.key === key) return known.item;
    const item = make();
    this.items.set(source as TurnItem, { key, item });
    return item;
  }

  private row(item: Item, position: number, threadId: ThreadId): OrchestrationV2ProjectedTurnItem {
    const known = this.rows.get(item);
    if (known?.position === position) return known;
    const row: OrchestrationV2ProjectedTurnItem = {
      position,
      visibility: "local",
      sourceThreadId: threadId,
      sourceItemId: item.id,
      item,
    };
    this.rows.set(item, row);
    return row;
  }
}

function lineText(line: Exclude<ChatEntry, Turn>): string {
  return line.kind === "restart" ? "The agent restarted" : line.restored ? "The kernel came back" : "The kernel restarted";
}

function mimeOf(dataUrl: string): string {
  return /^data:(image\/[\w.+-]+);/.exec(dataUrl)?.[1] ?? "image/jpeg";
}

/** A prompt's or waiting message's image, by the attachment id its message gives it: its thumbnail. */
export function attachmentImageUrl(chat: ChatState, threadId: string, attachmentId: string): string | null {
  for (const entry of chat.entries) {
    if (entry.kind !== "turn" || !entry.prompt) continue;
    const prefix = `${threadId}:prompt:${entry.id}:`;
    if (attachmentId.startsWith(prefix)) return entry.prompt.images[Number(attachmentId.slice(prefix.length))]?.thumb ?? null;
  }
  for (const queued of chat.queue) {
    if (queued.state === "steering") continue;
    const prefix = queuedAttachmentId(threadId, queued.id, 0).slice(0, -1);
    if (attachmentId.startsWith(prefix)) return queued.images[Number(attachmentId.slice(prefix.length))]?.thumb ?? null;
  }
  return null;
}
