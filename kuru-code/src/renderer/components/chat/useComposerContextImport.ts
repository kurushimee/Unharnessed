import type { RefObject } from "react";
import type { ChatComposerProps } from "./ChatComposer";
import {
  type ComposerContextClipboardFragment,
  type ComposerContextRecord,
  type EnvironmentId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
} from "~/contracts";
import { type ComposerImageAttachment, useComposerDraftStore } from "../../composerDraftStore";
import {
  asKnownContextRecord,
  attachmentContextRecord,
  composerContextImportLookupIds,
  isSameComposerContextPayload,
  reviewCommentContextId,
  reviewCommentContextRecord,
  reviewCommentFromRecord,
} from "~/lib/composerContextRecords";
import { copiedComposerAttachmentFile } from "~/lib/copiedComposerAttachments";
import { pendingDraftWork } from "./pendingDraftWork";
import { randomUUID } from "~/lib/utils";
import { toKindScopedComposerContextId } from "~/shared/composerContextReferences";
import { toastManager } from "../ui/toast";
import { type ComposerDraftContextRecords } from "../composerContextPresentation";
import { useStableCallback } from "../../hooks/useStableCallback";
import { countPreparingComposerImages } from "./preparingComposerImages";

/**
 * Imports copied composer context (review comments, threads and
 * images) into the open draft, and counts the attachment slots already spoken for.
 */
export function useComposerContextImport(input: {
  readonly environmentId: EnvironmentId;
  readonly activeThread: ChatComposerProps["activeThread"];
  readonly activeThreadId: ChatComposerProps["activeThreadId"];
  readonly composerDraftTarget: ChatComposerProps["composerDraftTarget"];
  readonly attachmentDraftTarget: ChatComposerProps["composerDraftTarget"];
  readonly attachmentTargetKey: string;
  readonly attachmentTargetKeyRef: RefObject<string>;
  readonly composerContextRecords: ComposerDraftContextRecords;
  readonly composerImages: ReadonlyArray<ComposerImageAttachment>;
  readonly pendingThreadImportsRef: RefObject<Map<string, number>>;
}) {
  const {
    environmentId,
    activeThread,
    activeThreadId,
    composerDraftTarget,
    attachmentDraftTarget,
    attachmentTargetKey,
    attachmentTargetKeyRef,
    composerContextRecords,
    composerImages,
    pendingThreadImportsRef,
  } = input;
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const addComposerDraftReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const addComposerDraftThreadContexts = useComposerDraftStore((store) => store.addThreadContexts);
  const countReservedAttachments = () => {
    const draft = getComposerDraft(attachmentDraftTarget);
    return (
      (draft?.images.length ?? 0) +
      countPreparingComposerImages(attachmentTargetKey) +
      (pendingThreadImportsRef.current.get(attachmentTargetKey) ?? 0)
    );
  };
  const countReservedAttachmentsStable = useStableCallback(countReservedAttachments);
  const runAttachmentImport = async (
    record: Extract<ComposerContextRecord, { kind: "image" | "file" }>,
    localId: string,
    sourceEnvironmentId: EnvironmentId,
    importTargetKey: string,
  ) => {
    const fail = (reason: string) => {
      toastManager.add({
        type: "error",
        title: `Couldn't bring ${record.name} into this message`,
        description: `${reason} Remove the chip or attach the file again.`,
      });
    };
    // Copied images keep their bytes in this window; nothing else holds them.
    const file = copiedComposerAttachmentFile(sourceEnvironmentId, record.attachmentId);
    if (!file) {
      fail("The original image is no longer available.");
      return;
    }
    // The draft these bytes belong to may have been sent or switched away from while they
    // downloaded. Dropping them here keeps them out of whatever draft is open now.
    if (attachmentTargetKeyRef.current !== importTargetKey) return;
    if (
      (pendingThreadImportsRef.current.get(importTargetKey) ?? 0) > 0 &&
      countReservedAttachments() >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS
    ) {
      fail("The attachment limit has been reached.");
      return;
    }
    if (record.kind !== "image") {
      fail("Unharnessed sends images only.");
      return;
    }
    const accepted = addComposerDraftImages(attachmentDraftTarget, [
      {
        type: "image",
        id: localId,
        name: record.name,
        mimeType: file.type,
        sizeBytes: file.size,
        previewUrl: URL.createObjectURL(file),
        file,
      },
    ]);
    if (!accepted.includes(localId))
      fail("The draft rejected this attachment (duplicate or attachment limit reached).");
  };
  const importAttachmentRecord = async (
    record: Extract<ComposerContextRecord, { kind: "image" | "file" }>,
    localId: string,
    sourceEnvironmentId: EnvironmentId,
  ) => {
    // The chip lands in the draft immediately while these bytes are still downloading. Count
    // the transfer against its own draft so a send cannot snapshot a message whose chip has no
    // attachment behind it, and so bytes for an abandoned draft never enter the next one.
    const importTargetKey = attachmentTargetKey;
    pendingDraftWork.begin(importTargetKey);
    await runAttachmentImport(record, localId, sourceEnvironmentId, importTargetKey).finally(() =>
      pendingDraftWork.end(importTargetKey),
    );
  };
  const importContextRecords = (
    records: ReadonlyArray<ComposerContextRecord>,
    sourceEnvironmentId: EnvironmentId | null,
    threadDraftTarget = attachmentDraftTarget,
  ): ReadonlyMap<string, string> => {
    const rewritten = new Map<string, string>();
    for (const candidate of records) {
      // Producer ids fold into context ids, so two different excerpts can collide. Only skip
      // when the draft already holds the same payload; a colliding but different record is
      // re-minted under a fresh id so both survive the paste.
      const record = asKnownContextRecord(candidate);
      if (!record) continue;
      const existing = composerContextImportLookupIds(record).flatMap((contextId) => {
        const found = composerContextRecords.get(contextId);
        return found ? [found] : [];
      })[0];
      // A copy of this draft's own attachment: the local bytes match.
      if (
        sourceEnvironmentId !== null &&
        (record.kind === "image" || record.kind === "file") &&
        (existing?.kind === "image" || existing?.kind === "file") &&
        existing.record.file !== null &&
        existing.record.file ===
          copiedComposerAttachmentFile(sourceEnvironmentId, record.attachmentId)
      )
        continue;
      const existingRecord =
        existing?.kind === "review-comment"
          ? reviewCommentContextRecord(existing.record)
          : existing?.kind === "thread"
            ? existing.record
            : existing?.record.file
              ? attachmentContextRecord({
                  attachment: existing.record,
                  attachmentId: existing.record.id,
                })
              : undefined;
      if (
        existingRecord &&
        isSameComposerContextPayload(existingRecord, record) &&
        (record.kind !== "thread" || threadDraftTarget === attachmentDraftTarget)
      ) {
        continue;
      }
      const conflicts = existing !== undefined;
      switch (record.kind) {
        case "review-comment": {
          const imported = reviewCommentFromRecord(record);
          const comment = conflicts ? { ...imported, id: randomUUID() } : imported;
          addComposerDraftReviewComment(composerDraftTarget, comment, {
            appendReference: false,
          });
          rewritten.set(record.contextId, reviewCommentContextId(comment.id));
          break;
        }
        case "thread": {
          // The agent reads sessions on this machine only.
          if (record.environmentId !== environmentId) break;
          addComposerDraftThreadContexts(threadDraftTarget, [record], {
            appendReference: false,
          });
          rewritten.set(record.contextId, record.contextId);
          break;
        }
        case "image":
        case "file": {
          if (sourceEnvironmentId === null && !conflicts) {
            rewritten.set(record.contextId, record.contextId);
            break;
          }
          if (sourceEnvironmentId === null) break;
          const localId = randomUUID();
          rewritten.set(record.contextId, toKindScopedComposerContextId(record.kind, localId));
          void importAttachmentRecord(record, localId, sourceEnvironmentId);
          break;
        }
        default:
          break;
      }
    }
    return rewritten;
  };
  const importContextFragment = (
    fragment: ComposerContextClipboardFragment,
  ): ReadonlyMap<string, string> =>
    importContextRecords(fragment.records, fragment.source.environmentId);
  const importContextFragmentStable = useStableCallback(importContextFragment);

  return {
    countReservedAttachments,
    countReservedAttachmentsStable,
    importContextRecords,
    importContextFragment,
    importContextFragmentStable,
  };
}
