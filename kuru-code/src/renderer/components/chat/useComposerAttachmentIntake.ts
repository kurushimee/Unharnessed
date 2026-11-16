import type { ChatComposerProps } from "./ChatComposer";
import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
} from "~/contracts";
import {
  type ComposerContextReference,
  collectInlineContextIds,
  stripInlineContextReferences,
} from "~/lib/composerContextReferences";
import { type ComposerImageAttachment } from "../../composerDraftStore";
import { type ComposerPromptEditorHandle } from "../ComposerPromptEditorTiptap";
import { type PendingUserInput } from "../../session-logic";
import { classifyComposerAttachmentFile, normalizeComposerImageFileMimeType } from "./composerAttachmentFiles";
import { imageContextReference } from "~/lib/composerContextRecords";
import { randomUUID } from "~/lib/utils";
import { wouldTextPasteExceedLimit } from "~/rt/textPaste";
import { inheritComposerImageThumbnail, prepareImageForAttachment } from "../../lib/imageCompression";
import { requestConfirmDialog } from "~/confirmDialog";
import { toastManager } from "../ui/toast";
import { type RefObject } from "react";
import {
  addPreparingComposerImages,
  isPreparingComposerImage,
  removePreparingComposerImages,
} from "./preparingComposerImages";

/**
 * Takes images into the draft: validates and reserves slots, compresses them, inserts their
 * inline chips, and confirms removing a referenced image. Unharnessed sends images only.
 */
export function useComposerAttachmentIntake(input: {
  readonly activeThreadId: ChatComposerProps["activeThreadId"];
  readonly pendingUserInputs: ReadonlyArray<PendingUserInput>;
  readonly isLiteralPendingAnswer: boolean;
  readonly projectSelectionRequired: boolean;
  readonly attachmentTargetKey: string;
  readonly promptRef: ChatComposerProps["promptRef"];
  readonly composerImagesRef: ChatComposerProps["composerImagesRef"];
  readonly composerEditorRef: RefObject<ComposerPromptEditorHandle | null>;
  readonly isRevertingCheckpointRef: RefObject<boolean>;
  readonly setThreadError: ChatComposerProps["setThreadError"];
  readonly countReservedAttachments: () => number;
  readonly addComposerImage: (image: ComposerImageAttachment) => string[];
  readonly addComposerImagesToDraft: (images: ComposerImageAttachment[]) => string[];
  readonly removeComposerImageFromDraft: (imageId: string) => void;
  readonly insertAttachmentReferences: (
    references: ReadonlyArray<ComposerContextReference>,
    selection?: { start: number; end: number },
  ) => boolean;
}) {
  const {
    activeThreadId,
    pendingUserInputs,
    isLiteralPendingAnswer,
    projectSelectionRequired,
    attachmentTargetKey,
    promptRef,
    composerImagesRef,
    composerEditorRef,
    isRevertingCheckpointRef,
    setThreadError,
    countReservedAttachments,
    addComposerImage,
    addComposerImagesToDraft,
    removeComposerImageFromDraft,
    insertAttachmentReferences,
  } = input;
  const addComposerAttachments = async (
    files: File[],
    options?: {
      readonly selection?: { start: number; end: number };
      readonly skipImageInlineChip?: boolean;
    },
  ): Promise<boolean> => {
    if (!activeThreadId || files.length === 0 || isRevertingCheckpointRef.current) return false;
    if (pendingUserInputs.length > 0) {
      toastManager.add({
        type: "error",
        title: "This question cannot accept attachments.",
      });
      return false;
    }
    // Captured before the awaits below: the user may switch threads while a
    // large image is being compressed, and the attachments and errors belong
    // to the thread the paste happened in.
    const threadId = activeThreadId;
    const imageAttachmentsGetChips =
      !options?.skipImageInlineChip &&
      (options?.selection !== undefined ||
        pendingUserInputs.length > 0 ||
        projectSelectionRequired ||
        stripInlineContextReferences(promptRef.current).trim().length > 0);

    // Validation happens synchronously so concurrent pastes see each other:
    // accepted files reserve their attachment slots (as preparing images)
    // before the first await, keeping the total under the limit.
    let reservedCount = countReservedAttachments();
    const acceptedImages: File[] = [];
    let error: string | null = null;
    for (const file of files) {
      const attachmentKind = classifyComposerAttachmentFile(file);
      if (reservedCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
        error = `A message carries ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} images at most.`;
        continue;
      }
      if (attachmentKind === "file") {
        // Unharnessed sends images with a message, not other files: @ names a file instead.
        error = `'${file.name}' is not an image. Name a file with @ instead.`;
        continue;
      }
      if (attachmentKind === "unsupported-image") {
        error = `'${file.name}' is not a supported image type. Attach GIF, HEIC, HEIF, JPEG, PNG, or WebP images.`;
        continue;
      }
      acceptedImages.push(normalizeComposerImageFileMimeType(file));
      reservedCount += 1;
    }
    setThreadError(threadId, error);
    if (acceptedImages.length === 0) return false;

    // The draft image reuses its placeholder's id and thumbnail so the strip tile stays exactly
    // as it is when the compressed file replaces it.
    const preparingImages = acceptedImages.map((file) => ({
      id: randomUUID(),
      name: file.name || "image",
      file,
    }));
    addPreparingComposerImages(attachmentTargetKey, preparingImages);
    const compressed: { id: string; file: File }[] = [];
    // Keyed by image so a failure whose tile was removed (even mid-compression) is not reported.
    const compressionErrors = new Map<string, string>();
    for (const { id, file } of preparingImages) {
      // Removed from the strip while an earlier image was compressing.
      if (!isPreparingComposerImage(attachmentTargetKey, id)) continue;
      // A rejection must still reach the cleanup below: a leaked
      // placeholder would block sending from this draft for good.
      const result = await prepareImageForAttachment(
        file,
        PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
      ).catch(() => ({ ok: false, reason: "unreadable" }) as const);
      if (!result.ok) {
        compressionErrors.set(
          id,
          result.reason === "unreadable"
            ? `'${file.name}' could not be read as an image.`
            : `'${file.name}' is too large to attach, even after compression.`,
        );
        continue;
      }
      inheritComposerImageThumbnail(file, result.file);
      compressed.push({ id, file: result.file });
    }
    // Same tick as the draft insert below, so the strip swaps placeholders for
    // real tiles in one render. A placeholder removed meanwhile stays removed.
    const stillPreparingIds = removePreparingComposerImages(
      attachmentTargetKey,
      new Set(preparingImages.map((image) => image.id)),
    );
    const nextImages: ComposerImageAttachment[] = compressed
      .filter(({ id }) => stillPreparingIds.has(id))
      .map(({ id, file }) => ({
        type: "image",
        id,
        name: file.name || "image",
        mimeType: file.type,
        sizeBytes: file.size,
        previewUrl: URL.createObjectURL(file),
        file,
      }));
    const storedImageIds = new Set(
      nextImages.length === 1 && nextImages[0]
        ? addComposerImage(nextImages[0])
        : nextImages.length > 1
          ? addComposerImagesToDraft(nextImages)
          : [],
    );
    const storedImages = nextImages.filter((image) => storedImageIds.has(image.id));
    // The draft may be gone by now; revoking a URL the store already revoked is harmless.
    for (const image of nextImages) {
      if (!storedImageIds.has(image.id)) URL.revokeObjectURL(image.previewUrl);
    }
    const insertedChips =
      storedImages.length > 0 && imageAttachmentsGetChips
        ? insertAttachmentReferences(storedImages.map(imageContextReference))
        : false;
    // Only failures are reported here. Success must not pass `null`: by
    // now other work (a failed send, an overlapping paste) may have set a
    // thread error this call knows nothing about, and clearing it would
    // swallow that message.
    const compressionError = [...compressionErrors]
      .filter(([id]) => stillPreparingIds.has(id))
      .map(([, message]) => message)
      .at(-1);
    if (compressionError !== undefined) {
      setThreadError(threadId, compressionError);
    }
    return insertedChips;
  };

  const removeComposerImage = (imageId: string) => {
    if (removePreparingComposerImages(attachmentTargetKey, new Set([imageId])).size > 0) {
      // Its compression finishes in the background and is dropped.
      return;
    }
    const image = composerImagesRef.current.find((candidate) => candidate.id === imageId);
    const referenced = collectInlineContextIds(promptRef.current).includes(
      image ? imageContextReference(image).contextId : "",
    );
    if (!referenced) {
      removeComposerImageFromDraft(imageId);
      return;
    }
    const confirmation = requestConfirmDialog(
      `Remove ${image?.name ?? "this image"} from the message?\nIt is referenced in your text; removing it also removes every reference.`,
      { variant: "destructive" },
    );
    if (!confirmation) {
      removeComposerImageFromDraft(imageId);
      return;
    }
    void confirmation.then((confirmed) => {
      if (confirmed) removeComposerImageFromDraft(imageId);
    });
  };

  /** A paste past the message's limit is refused whole, with a note; anything shorter goes in as text. */
  const foldPastedText = (
    plainText: string,
    _bypassAutoAttachment: boolean,
    selectionOverride?: { start: number; end: number },
  ): boolean => {
    if (isLiteralPendingAnswer) return false;
    const selection = selectionOverride ?? composerEditorRef.current?.readSelectionRange();
    const wouldExceedInputLimit = wouldTextPasteExceedLimit({
      valueLength: promptRef.current.length,
      selection: selection ?? { start: 0, end: 0 },
      textLength: plainText.length,
      maxLength: PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
    });
    if (!wouldExceedInputLimit) return false;
    toastManager.add({
      type: "error",
      title: "Pasted text is too large for this message",
      description: "Remove some text, then paste again.",
      data: { hideCopyButton: true },
    });
    return true;
  };

  return {
    addComposerAttachments,
    removeComposerImage,
    foldPastedText,
  };
}
