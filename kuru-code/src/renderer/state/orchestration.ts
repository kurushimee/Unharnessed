// T3 Code's state/orchestration.ts, the queries the thread view reads. T3 Code
// asks its server; kuru code answers from the projection it keeps of the
// conversation on screen (kuru/threadDetails.ts) and from its main process.
import {
  LOCAL_ENVIRONMENT_ID,
  type EnvironmentId,
  type OrchestrationV2GetTurnItemResult,
  type OrchestrationV2SearchThreadInput,
  type OrchestrationV2SearchThreadResult,
  type OrchestrationV2ThreadLinkMetadata,
  type ThreadId,
  type TurnItemId,
} from "~/contracts";
import { environmentThreadDetails } from "~/kuru/threadDetails";
import { readShells } from "~/kuru/shells";
import { findInThread } from "~/kuru/threadFind";
import type { CommandOutputView } from "~/rt/state/commandOutput";
import { appendTerminalOutput, EMPTY_TERMINAL_OUTPUT } from "~/shared/terminalOutput";
import { AsyncResult, Atom } from "effect/reactivity";

interface Target<Input> {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
}

/** An item's whole detail: kuru code's projection has every item whole. */
const turnItemFamily = Atom.family((key: string) => {
  const { environmentId, input } = JSON.parse(key) as Target<{ threadId: ThreadId; itemId: TurnItemId }>;
  return Atom.make((get): AsyncResult.AsyncResult<OrchestrationV2GetTurnItemResult, never> => {
    const thread = get(environmentThreadDetails.threadAtom({ environmentId, threadId: input.threadId }));
    const item = thread?.projection.turnItems.findLast((candidate) => candidate.id === input.itemId) ?? null;
    return AsyncResult.success({ item });
  });
});

/** What a thread link shows of the threads it names: their titles, from the sidebar's shells. */
const threadLinkMetadataFamily = Atom.family((key: string) => {
  const { input } = JSON.parse(key) as Target<{ threadIds: ReadonlyArray<ThreadId> }>;
  return Atom.make((): AsyncResult.AsyncResult<Record<string, OrchestrationV2ThreadLinkMetadata>, never> => {
    const shells = readShells().threadByKey;
    const found: Record<string, OrchestrationV2ThreadLinkMetadata> = {};
    for (const threadId of input.threadIds) {
      const shell = shells.get(`${LOCAL_ENVIRONMENT_ID}:${threadId}`);
      if (shell) found[threadId] = { title: shell.title } as OrchestrationV2ThreadLinkMetadata;
    }
    return AsyncResult.success(found);
  });
});

/** Find in the thread on screen: kuru code has its whole conversation here. */
const threadFindFamily = Atom.family((key: string) => {
  const { environmentId, input } = JSON.parse(key) as Target<OrchestrationV2SearchThreadInput>;
  return Atom.make((get): AsyncResult.AsyncResult<OrchestrationV2SearchThreadResult, never> => {
    const thread = get(environmentThreadDetails.threadAtom({ environmentId, threadId: input.threadId }));
    if (thread === null) return AsyncResult.initial(true);
    const shells = readShells();
    const projectId = shells.threadByKey.get(`${environmentId}:${input.threadId}`)?.projectId;
    const cwd = projectId === undefined ? undefined : shells.projectByKey.get(`${environmentId}:${projectId}`)?.workspaceRoot;
    return AsyncResult.success(findInThread(thread.projection, input, cwd));
  });
});

/** A command's output, as T3 Code streams it: the tool call's output in the projection. */
const commandOutputFamily = Atom.family((key: string) => {
  const { environmentId, input } = JSON.parse(key) as Target<{ threadId: ThreadId; itemId: TurnItemId }>;
  return Atom.make((get): AsyncResult.AsyncResult<CommandOutputView, never> => {
    const thread = get(environmentThreadDetails.threadAtom({ environmentId, threadId: input.threadId }));
    const item = thread?.projection.turnItems.findLast((candidate) => candidate.id === input.itemId);
    const text = item?.type === "command_execution" ? (item.output ?? "") : "";
    return AsyncResult.success({
      output: appendTerminalOutput(EMPTY_TERMINAL_OUTPUT, text),
      running: item?.status === "running",
    });
  });
});

export const orchestrationEnvironment = {
  turnItem: (target: Target<{ threadId: ThreadId; itemId: TurnItemId; revision?: string }>) =>
    turnItemFamily(
      JSON.stringify({
        environmentId: target.environmentId,
        input: { threadId: target.input.threadId, itemId: target.input.itemId },
      }),
    ),
  threadLinkMetadata: (target: Target<{ threadIds: ReadonlyArray<ThreadId> }>) =>
    threadLinkMetadataFamily(JSON.stringify(target)),
  threadFind: (target: Target<OrchestrationV2SearchThreadInput>) => threadFindFamily(JSON.stringify(target)),
  threadFindProgressive: (target: Target<OrchestrationV2SearchThreadInput>) =>
    threadFindFamily(JSON.stringify(target)),
  v2: {
    commandOutput: (target: Target<{ threadId: ThreadId; itemId: TurnItemId }>) =>
      commandOutputFamily(JSON.stringify(target)),
  },
};
