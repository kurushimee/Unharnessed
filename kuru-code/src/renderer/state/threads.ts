// T3 Code's state/threads.ts: the thread commands its server takes. kuru
// code keeps a thread's title in its own notes (main/store.ts), since an
// Unharnessed session keeps the name its first message gave it.
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import type { EnvironmentId, ThreadId } from "~/contracts";
import { invoke } from "~/bridge";
import { settlePromise, type AtomCommandResult } from "~/rt/state/runtime";

export interface ThreadMetadataUpdate {
  readonly environmentId: EnvironmentId;
  readonly input: {
    readonly threadId: ThreadId;
    readonly title?: string;
    readonly regenerateTitle?: boolean;
  };
}

export type OrchestrationCommand<I> = (input: I) => Promise<AtomCommandResult<unknown, unknown>>;

const updateMetadata: OrchestrationCommand<ThreadMetadataUpdate> = async ({ input }) => {
  if (input.regenerateTitle) {
    return AsyncResult.failure(Cause.fail(new Error("Unharnessed has no title generator.")));
  }
  return settlePromise(() =>
    invoke("threads.update", {
      id: input.threadId,
      change: input.title === undefined ? {} : { title: input.title },
    }),
  );
};

export const threadEnvironment = { updateMetadata };
