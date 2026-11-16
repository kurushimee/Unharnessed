import { type MessageId } from "~/contracts";
import { useState } from "react";
import { type ComposerSubmissionIntent } from "../../composer-logic";
import { type SessionPhase, type Thread } from "../../types";
import {
  createLocalDispatchSnapshot,
  hasServerAcknowledgedLocalDispatch,
  type LocalDispatchSnapshot,
} from "../ChatView.logic";

export function useLocalDispatchState(input: {
  activeThread: Thread | undefined;
  activeLatestRun: Thread["latestRun"] | null;
  latestUserMessageId: MessageId | null;
  phase: SessionPhase;
  threadError: string | null | undefined;
}) {
  const [localDispatch, setLocalDispatch] = useState<LocalDispatchSnapshot | null>(null);

  const resetLocalDispatch = () => {
    setLocalDispatch(null);
  };

  const serverAcknowledgedLocalDispatch = hasServerAcknowledgedLocalDispatch({
    localDispatch,
    phase: input.phase,
    latestRun: input.activeLatestRun,
    latestUserMessageId: input.latestUserMessageId,
    runtime: input.activeThread?.runtime ?? null,
    threadError: input.threadError,
  });
  const activeLocalDispatch = serverAcknowledgedLocalDispatch ? null : localDispatch;
  const beginLocalDispatch = (options?: { submissionIntent?: ComposerSubmissionIntent }) => {
    setLocalDispatch((current) => {
      const active = serverAcknowledgedLocalDispatch ? null : current;
      if (active) {
        const submissionIntent = options?.submissionIntent ?? active.submissionIntent;
        return active.submissionIntent === submissionIntent ? active : { ...active, submissionIntent };
      }
      return createLocalDispatchSnapshot(input.activeThread, {
        ...options,
        latestUserMessageId: input.latestUserMessageId,
      });
    });
  };

  return {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt: activeLocalDispatch?.startedAt ?? null,
    isSendBusy: activeLocalDispatch !== null,
    backgroundSubmissionPending: activeLocalDispatch?.submissionIntent === "background",
  };
}
