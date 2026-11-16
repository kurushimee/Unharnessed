import type { ChatAttachment } from "~/contracts";
import { CircleAlertIcon, ImageIcon, PaperclipIcon, XIcon } from "lucide-react";
import { useRef } from "react";

import { type ComposerImageAttachment } from "../../composerDraftStore";
import { isHeicImageFile } from "../../lib/imageCompression";
import { cn } from "~/lib/utils";
import { getRestingComposerImagePreviewCounts } from "../composerFooterLayout";
import { AttachmentImage } from "../media/AttachmentImage";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerImageThumbnail } from "./ComposerImageThumbnail";
import type { PreparingComposerImage } from "./preparingComposerImages";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./ExpandedImagePreview";
import { PierreEntryIcon } from "./PierreEntryIcon";

function ComposerImageFallback() {
  return (
    <span
      role="img"
      aria-label="Image attachment"
      className="flex size-full items-center justify-center p-3 text-secondary-label"
    >
      <ImageIcon aria-hidden="true" className="size-4" />
    </span>
  );
}

/** Image tiles above the composer editor. */
export function ComposerAttachmentMediaRow({
  images,
  expandedImages,
  preparingImages,
  nonPersistedImageIds,
  onExpandImage,
  onRemoveImage,
}: {
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  readonly expandedImages: ReadonlyArray<ComposerImageAttachment>;
  readonly preparingImages: ReadonlyArray<PreparingComposerImage>;
  readonly nonPersistedImageIds: ReadonlyArray<string>;
  readonly onExpandImage: (preview: ExpandedImagePreview) => void;
  readonly onRemoveImage: (imageId: string) => void;
}) {
  const nonPersistedImageIdSet = new Set(nonPersistedImageIds);
  return (
    <div
      className={cn(
        "mb-3 flex max-w-full flex-wrap gap-2",
      )}
    >
      {/* A preparing image renders through the same tile, keyed by the id its compressed image
          takes, so the thumbnail element survives the swap. */}
      {[
        ...expandedImages.map((image) => ({ image, ready: image })),
        ...preparingImages.map((image) => ({ image, ready: null })),
      ]
        .map(({ image, ready }) => {
          return (
            <div
              key={image.id}
              data-chat-composer-expanded-image="true"
              className="group/attachment relative h-16 w-16 shrink-0 snap-start overflow-hidden rounded-lg border border-border/80 bg-background"
            >
              {!ready || ready.previewUrl ? (
                <button
                  type="button"
                  className={cn("h-full w-full", ready && "cursor-zoom-in")}
                  aria-label={`Preview ${image.name}`}
                  disabled={!ready}
                  onClick={() => {
                    const preview = buildExpandedImagePreview(images, image.id);
                    if (!preview) return;
                    onExpandImage(preview);
                  }}
                >
                  <ComposerImageThumbnail
                    file={image.file}
                    alt={image.name}
                    className="h-full w-full object-cover"
                    fallback={
                      ready && isHeicImageFile({ name: ready.name, type: ready.mimeType }) ? (
                        <AttachmentImage
                          name={ready.name}
                          mimeType={ready.mimeType}
                          src={ready.previewUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ComposerImageFallback />
                      )
                    }
                  />
                </button>
              ) : (
                <ComposerImageFallback />
              )}
              {nonPersistedImageIdSet.has(image.id) && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        role="img"
                        aria-label="Draft attachment may not persist"
                        className="absolute left-1 top-1 inline-flex items-center justify-center rounded bg-background/85 p-0.5 text-warning-foreground"
                      >
                        <CircleAlertIcon className="size-3" />
                      </span>
                    }
                  />
                  <TooltipPopup side="top">
                    Draft attachment could not be saved locally and may be lost on navigation.
                  </TooltipPopup>
                </Tooltip>
              )}
              {!ready && (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-background/85 px-1 text-center text-3xs text-foreground">
                  Preparing
                </span>
              )}
              <span className="absolute right-1 top-1 flex">
                <Button
                  variant="media-close"
                  size="icon-xs"
                  onClick={() => onRemoveImage(image.id)}
                  aria-label={`Remove ${image.name}`}
                >
                  <XIcon />
                </Button>
              </span>
            </div>
          );
        })}
    </div>
  );
}

/** Thumbnails beside the single-line prompt while the composer rests. */
export function ComposerRestingImagePreviews({
  images,
  allImages,
  resolvedTheme,
  onExpandImage,
  onShowMore,
}: {
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  readonly allImages: ReadonlyArray<ComposerImageAttachment>;
  readonly resolvedTheme: "light" | "dark";
  readonly onExpandImage: (preview: ExpandedImagePreview) => void;
  readonly onShowMore: () => void;
}) {
  const counts = getRestingComposerImagePreviewCounts(images.length);
  const visibleImages = images.slice(0, counts.visibleCount);
  return (
    <div data-chat-composer-resting-images="true" className="flex shrink-0 items-center gap-1 ps-1">
      {visibleImages.map((image) => (
        <button
          key={image.id}
          type="button"
          className="relative size-7 shrink-0 cursor-zoom-in overflow-hidden rounded-md border border-border/70 bg-muted/60"
          aria-label={`Preview ${image.name}`}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            const preview = buildExpandedImagePreview(allImages, image.id);
            if (preview) onExpandImage(preview);
          }}
        >
          {image.previewUrl ? (
            <ComposerImageThumbnail
              file={image.file}
              alt=""
              className="size-full object-cover"
              fallback={
                isHeicImageFile({ name: image.name, type: image.mimeType }) ? (
                  <AttachmentImage
                    name={image.name}
                    mimeType={image.mimeType}
                    src={image.previewUrl}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <PierreEntryIcon
                    pathValue={image.name}
                    kind="file"
                    theme={resolvedTheme}
                    className="m-auto size-3.5"
                  />
                )
              }
            />
          ) : (
            <PierreEntryIcon
              pathValue={image.name}
              kind="file"
              theme={resolvedTheme}
              className="m-auto size-3.5"
            />
          )}
        </button>
      ))}
      {counts.overflowCount > 0 ? (
        <button
          type="button"
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border/70 bg-muted/60 font-medium text-secondary-label text-xs tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          aria-label={`Show ${String(counts.overflowCount)} more image attachments`}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onShowMore}
        >
          +{counts.overflowCount}
        </button>
      ) : null}
    </div>
  );
}

/** Attachments of the queued message being edited; they are already uploaded. */
export function ComposerQueuedAttachmentRow({
  attachments,
  onRemove,
}: {
  readonly attachments: ReadonlyArray<{
    readonly attachment: ChatAttachment;
    readonly url: string | null;
  }>;
  readonly onRemove: (attachmentId: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {attachments.map(({ attachment, url }) => (
        <div
          key={attachment.id}
          className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/80 bg-background"
        >
          {attachment.type === "image" && url ? (
            <img src={url} alt={attachment.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-1 text-center text-3xs text-secondary-label">
              {attachment.name}
            </div>
          )}
          <Button
            variant="media-close"
            size="icon-xs"
            className="absolute right-1 top-1"
            onClick={() => onRemove(attachment.id)}
            aria-label={`Remove ${attachment.name}`}
          >
            <XIcon />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function ComposerAttachButton({
  addComposerAttachments,
  focusComposer,
}: {
  readonly addComposerAttachments: (files: File[]) => Promise<boolean>;
  readonly focusComposer: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          // Inserting a chip refocuses the editor after the draft renders;
          // focusing synchronously here would report the editor's stale text
          // over the prompt that was just written.
          void addComposerAttachments(files).then((inserted) => {
            if (!inserted) focusComposer();
          });
        }}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => inputRef.current?.click()}
              aria-label="Attach images"
            />
          }
        >
          {/* The clip's weight sits in its upper loop; 1px down reads as centered on the row. */}
          <PaperclipIcon className="translate-y-px" />
        </TooltipTrigger>
        <TooltipPopup>Attach images</TooltipPopup>
      </Tooltip>
    </>
  );
}
