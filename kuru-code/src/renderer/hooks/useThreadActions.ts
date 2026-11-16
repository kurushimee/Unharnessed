// Adapted from T3 Code's hooks/useThreadActions.ts. T3 Code's thread actions
// are orchestration commands to its server; kuru code's change the thread's
// notes in its main process (settled, pinned, their order...), and a
// delete asks the Unharnessed agent to remove the session. The rules each
// command keeps on T3 Code's server (settling unpins, pinning un-settles)
// are kept here, and so are the Undo notices.
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useRouter } from "@tanstack/react-router";
import type { ScopedThreadRef } from "~/contracts";
import { scopedThreadKey } from "~/rt/environment/index";
import { threadRuntimeCanArchive } from "~/rt/state/models";
import { pinOrderKeyBetween } from "~/rt/state/threadSort";
import * as ThreadUndo from "~/rt/state/threadUndo";
import { invoke } from "~/bridge";
import { readThreadShell, readShells } from "~/kuru/shells";
import { readLocalApi } from "~/localApi";
import { settlePromise, type AtomCommandResult } from "~/rt/state/runtime";
import { useUiStateStore } from "~/uiStateStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useClientSettings } from "./useSettings";
import { showThreadUndoNotice } from "./showThreadUndoNotice";

type Result = AtomCommandResult<unknown, unknown>;
type MetaChange = Record<string, string | number | boolean | null>;

const now = () => new Date().toISOString();

async function update(target: ScopedThreadRef, change: MetaChange): Promise<Result> {
  return settlePromise(() => invoke("threads.update", { id: target.threadId, change }));
}

function fail(message: string): Result {
  return AsyncResult.failure(Cause.fail(new Error(message)));
}

function topOfPinnedRunOrderKey(): string | undefined {
  let firstKey: string | null = null;
  for (const shell of readShells().threads) {
    if (shell.pinnedAt == null || shell.pinOrderKey == null) continue;
    if (firstKey === null || shell.pinOrderKey < firstKey) firstKey = shell.pinOrderKey;
  }
  return pinOrderKeyBetween(null, firstKey) ?? undefined;
}

async function requestThreadUnpinConfirmation(input: {
  enabled: boolean;
  title: string;
  confirm: ((message: string) => Promise<boolean>) | null;
}) {
  const { confirm } = input;
  if (!input.enabled || confirm === null) {
    return AsyncResult.success(true);
  }
  return settlePromise(() =>
    confirm(
      [
        `Unpin thread "${input.title}"?`,
        "This will move the thread out of your pinned section.",
      ].join("\n"),
    ),
  );
}

export function useThreadActions() {
  const router = useRouter();
  const confirmThreadUnpin = useClientSettings((settings) => settings.confirmThreadUnpin);

  const isRouteThread = (target: ScopedThreadRef) => {
    const params = router.state.matches.at(-1)?.params as
      | { environmentId?: string; threadId?: string }
      | undefined;
    return params?.environmentId === target.environmentId && params?.threadId === target.threadId;
  };

  const runUndoPlan = (target: ScopedThreadRef, plan: ThreadUndo.ThreadUndoPlan) =>
    ThreadUndo.executeThreadUndo(
      plan,
      async (step): Promise<Result> => {
        switch (step.action) {
          case "unsettle":
            return unsettleThread(target);
          case "pin":
            return pinThread(target, step.orderKey === undefined ? {} : { orderKey: step.orderKey });
        }
      },
      (result) => result._tag === "Success",
    );

  const settleThread = async (target: ScopedThreadRef): Promise<Result> => {
    const thread = readThreadShell(target);
    const undoPlan = ThreadUndo.planThreadUndo("settle", thread);
    ThreadUndo.invalidate("pin", scopedThreadKey(target));
    const action = ThreadUndo.begin("settle", scopedThreadKey(target));
    const result = await update(target, {
      settledAt: Date.now(),
      unsettledAt: null,
      pinnedAt: null,
      pinOrderKey: null,
    });
    if (result._tag !== "Success") {
      action.finish();
      return result;
    }
    showThreadUndoNotice({
      action: "Settled",
      claim: action,
      undo: () => runUndoPlan(target, undoPlan),
      failureTitle: "Failed to undo settle",
    });
    return result;
  };

  const unsettleThread = async (target: ScopedThreadRef): Promise<Result> => {
    ThreadUndo.invalidate("settle", scopedThreadKey(target));
    return update(target, { settledAt: null, unsettledAt: Date.now() });
  };

  const setThreadAutoSettle = async (target: ScopedThreadRef, enabled: boolean): Promise<Result> =>
    update(target, { autoSettleDisabledAt: enabled ? null : Date.now() });

  const pinThread = async (
    target: ScopedThreadRef,
    opts: { orderKey?: string } = {},
  ): Promise<Result> => {
    const orderKey = opts.orderKey ?? topOfPinnedRunOrderKey();
    ThreadUndo.invalidate("pin", scopedThreadKey(target));
    ThreadUndo.invalidate("settle", scopedThreadKey(target));
    return update(target, {
      pinnedAt: Date.now(),
      pinOrderKey: orderKey ?? null,
      settledAt: null,
    });
  };

  const unpinThread = async (target: ScopedThreadRef): Promise<Result> => {
    const thread = readThreadShell(target);
    const undoPlan = ThreadUndo.planThreadUndo("unpin", thread);
    const action = ThreadUndo.begin("pin", scopedThreadKey(target));
    const result = await update(target, { pinnedAt: null, pinOrderKey: null });
    if (result._tag === "Success" && action.isCurrent()) {
      showThreadUndoNotice({
        action: "Unpinned",
        claim: action,
        undo: () => runUndoPlan(target, undoPlan),
        failureTitle: "Failed to undo unpin",
      });
    } else {
      action.finish();
    }
    return result;
  };

  const confirmAndUnpinThread = async (target: ScopedThreadRef): Promise<Result> => {
    const localApi = readLocalApi();
    const thread = readThreadShell(target);
    const confirmation = await requestThreadUnpinConfirmation({
      enabled: confirmThreadUnpin,
      title: thread?.title ?? "this thread",
      confirm: localApi ? (message) => localApi.dialogs.confirm(message) : null,
    });
    if (confirmation._tag === "Failure") return confirmation;
    if (!confirmation.value) return AsyncResult.success(undefined);
    return unpinThread(target);
  };

  const reorderPinnedThread = async (target: ScopedThreadRef, orderKey: string): Promise<Result> => {
    ThreadUndo.invalidate("pin", scopedThreadKey(target));
    return update(target, { pinOrderKey: orderKey });
  };

  const reorderActiveThread = async (target: ScopedThreadRef, orderKey: string): Promise<Result> =>
    update(target, { activeOrderKey: orderKey });

  const markThreadUnread = (target: ScopedThreadRef) => {
    void update(target, { unread: true });
    useUiStateStore
      .getState()
      .markThreadUnread(scopedThreadKey(target), readThreadShell(target)?.latestRun?.completedAt);
  };

  const leaveRouteThread = (target: ScopedThreadRef) => {
    if (isRouteThread(target)) void router.navigate({ to: "/" });
  };

  const archiveThread = async (
    target: ScopedThreadRef,
    opts: { onArchived?: () => void } = {},
  ): Promise<Result> => {
    const thread = readThreadShell(target);
    if (!thread) return AsyncResult.success(undefined);
    if (!threadRuntimeCanArchive(thread.runtime)) {
      return fail("Stop the thread's turn before archiving it.");
    }
    const wasRoute = isRouteThread(target);
    const action = ThreadUndo.begin("archive", scopedThreadKey(target));
    const result = await update(target, { archivedAt: Date.now() });
    if (result._tag === "Failure") {
      action.finish();
      return result;
    }
    for (const kind of ["settle", "pin"]) ThreadUndo.invalidate(kind, scopedThreadKey(target));
    opts.onArchived?.();
    showThreadUndoNotice({
      action: "Archived",
      claim: action,
      undo: () => update(target, { archivedAt: null }),
      failureTitle: "Failed to undo archive",
    });
    if (wasRoute) leaveRouteThread(target);
    return result;
  };

  const deleteThread = async (
    target: ScopedThreadRef,
    _opts: { deletedThreadKeys?: ReadonlySet<string> } = {},
  ): Promise<Result> => {
    for (const kind of ["settle", "pin", "archive"]) {
      ThreadUndo.invalidate(kind, scopedThreadKey(target));
    }
    useComposerDraftStore.getState().clearComposerContent(target);
    leaveRouteThread(target);
    const result = await settlePromise(() => invoke<string | null>("threads.delete", { id: target.threadId }));
    if (result._tag === "Success" && typeof result.value === "string") return fail(result.value);
    return result;
  };

  return {
    settleThread,
    unsettleThread,
    pinThread,
    unpinThread,
    confirmAndUnpinThread,
    setThreadAutoSettle,
    reorderPinnedThread,
    reorderActiveThread,
    markThreadUnread,
    archiveThread,
    deleteThread,
  };
}

