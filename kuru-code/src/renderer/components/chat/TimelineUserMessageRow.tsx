import { remarkEnableOrderedListNumbers } from "~/shared/markdownPipeline";
import { findRevealRef } from "./markdownFindContext";
import { type MessageId, type ServerProviderSkill } from "~/contracts";
import { replaceComposerContextReferences } from "~/shared/composerContextReferences";
import { memo, use, useState, type ReactNode } from "react";
import { createMessageAttachmentPreviewProjector, selectMessageImageResources } from "../../session-logic";
import { isImageAttachment } from "../../types";
import ChatMarkdown from "../ChatMarkdown";
import { Redo2Icon, PencilIcon } from "lucide-react";
import { Button } from "../ui/button";
import { useAssetUrls } from "../../assets/assetUrls";
import { AttachmentImage } from "../media/AttachmentImage";
import { buildExpandedImagePreview } from "./ExpandedImagePreview";
import { MessageCopyButton } from "./MessageCopyButton";
import { shouldCollapseUserMessage } from "./MessagesTimeline.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  asKnownContextRecord,
  resolveUserMessageContext,
  selectedMessageContextFragment,
} from "~/lib/composerContextRecords";
import { collectComposerContextReferences, formatComposerContextReference } from "~/shared/composerContextReferences";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextClipboardHtml,
  encodeComposerContextFragment,
} from "~/shared/composerContextClipboard";
import { chatMarkdownClipboardPayload } from "../../markdown-clipboard";
import type { ChatMarkdownContextReference } from "../ChatMarkdown";
import { cn } from "~/lib/utils";
import { markdownProseDirection } from "~/textDirection";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestampFormat";
import { TimelineRowCtx, TimelineRowActivityCtx, type TimelineRow } from "./timelineRowContext";
import { MESSAGE_HEADING_LEVEL, MessageAuthorHeading } from "./TimelineRowParts";
import { UserMessageContextReferenceChip } from "./UserMessageContextChips";

// Drawn inside the media so dark screenshots keep an edge on the dark background.
const MEDIA_EDGE_CLASS_NAME =
  "relative after:pointer-events-none after:absolute after:inset-0 after:z-10 after:rounded-[inherit] after:ring-1 after:ring-inset after:ring-black/9 dark:after:ring-white/12";

const BUBBLE_CHIP_CLASS_NAME =
  "[&_[data-slot=context-chip]]:[--context-chip-ink:var(--context-chip-message,var(--context-chip-accent))]";

export function UserMessageRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  return <UserTimelineRow row={row} />;
}

function UserMessageProjectedStatus({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const status = row.projectedItem?.item.status;
  if (
    status === undefined ||
    status === "completed" ||
    status === "pending" ||
    status === "waiting"
  )
    return null;
  return (
    <div className="me-1 flex items-center gap-1.5">
      <span className="rounded-full border border-destructive/25 bg-destructive/8 px-1.5 py-0.5 text-3xs font-medium text-destructive">
        {status}
      </span>
    </div>
  );
}

function UserTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const ctx = use(TimelineRowCtx);
  const { onImageExpand } = ctx;
  const coarsePointer = useMediaQuery({ pointer: "coarse" });
  const resources = selectMessageImageResources(row.message.attachments);
  const previewUrls = useAssetUrls(ctx.activeThreadEnvironmentId, resources);
  const [projectPreviews] = useState(createMessageAttachmentPreviewProjector);
  const previewUrlsById = new Map(
    resources.flatMap((resource, index) => {
      const url = previewUrls[index];
      return url ? [[resource.attachmentId, url] as const] : [];
    }),
  );
  const messageWithPreviews = projectPreviews(row.message, (attachment) =>
    previewUrlsById.get(attachment.id),
  );
  const userImages = (messageWithPreviews.attachments ?? []).filter(isImageAttachment);
  const resolvedContext = resolveUserMessageContext(row.message);
  const attachmentReferences = collectComposerContextReferences(resolvedContext.text).flatMap(
    (occurrence) => {
      const record = asKnownContextRecord(resolvedContext.recordsById.get(occurrence.contextId));
      return record?.kind === "image"
        ? [
            {
              attachmentId: record.attachmentId,
              contextId: occurrence.contextId,
              source: occurrence.source,
            },
          ]
        : [];
    },
  );
  const chippedAttachmentIds = new Set(
    attachmentReferences.map((reference) => reference.attachmentId),
  );
  const regularImages = userImages;
  // Images sent without words show as media, not as a bubble around them.
  const mediaOnly = resolvedContext.text.trim() === "" && regularImages.length > 0;
  // Media sent with words sits above the bubble as its own shape, like a chat app.
  const mediaAboveText = !mediaOnly && regularImages.length > 0;
  const standaloneMedia = mediaOnly || mediaAboveText;
  // A lone image keeps its own shape; a 4:3 crop hides most of a wide screenshot.
  const loneImage = standaloneMedia && regularImages.length === 1;
  // Several images share one rounded shape, split by hairlines.
  const collage = standaloneMedia && regularImages.length > 1;
  // Corners that touch the bubble or a neighbouring message tighten, like the bubble's.
  const mediaCornerClassName = cn(
    row.groupedWithPrevious && "rounded-tr-md",
    (mediaAboveText || row.groupedWithNext) && "rounded-br-md",
  );
  const plainText = replaceComposerContextReferences(
    resolvedContext.text,
    (reference) => reference.label,
  );
  const mediaCopyRecords = mediaOnly
    ? resolvedContext.records.flatMap((record) => {
        const known = asKnownContextRecord(record);
        return known?.kind === "image" &&
          regularImages.some((image) => image.id === known.attachmentId)
          ? [known]
          : [];
      })
    : [];
  const copyRecords = mediaOnly ? mediaCopyRecords : resolvedContext.records;
  const contextClipboardFragment =
    copyRecords.length === 0
      ? null
      : encodeComposerContextFragment({
          version: 1,
          source: {
            environmentId: ctx.activeThreadEnvironmentId,
            ...(ctx.threadRef ? { threadId: ctx.threadRef.threadId } : {}),
            messageId: row.message.id,
          },
          records: copyRecords,
        });
  const copyText =
    resolvedContext.text || mediaCopyRecords.map(formatComposerContextReference).join("\n");
  const onBodyCopyCapture = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (resolvedContext.records.length === 0 || !event.clipboardData) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const copiedMarkdown: string[] = [];
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const container = document.createElement("div");
      container.appendChild(selection.getRangeAt(index).cloneContents());
      // Diagram source is copied text, not authority to export context records.
      for (const element of container.querySelectorAll(
        "[data-markdown-copy]:not([data-markdown-mermaid])",
      )) {
        copiedMarkdown.push(element.getAttribute("data-markdown-copy") ?? "");
      }
    }
    const fragment = selectedMessageContextFragment({
      markdown: copiedMarkdown.join("\n"),
      records: resolvedContext.records,
      environmentId: ctx.activeThreadEnvironmentId,
      ...(ctx.threadRef ? { threadId: ctx.threadRef.threadId } : {}),
      messageId: row.message.id,
    });
    if (!fragment) return;
    // Claim the copy: without preventDefault the browser default overwrites the
    // custom MIME type. The default content must then be written back explicitly.
    const payload = chatMarkdownClipboardPayload(selection);
    event.preventDefault();
    event.clipboardData.setData("text/plain", payload?.text ?? selection.toString());
    if (payload) {
      event.clipboardData.setData(
        "text/html",
        encodeComposerContextClipboardHtml(payload.text, fragment, payload.html),
      );
    }
    event.clipboardData.setData(COMPOSER_CONTEXT_CLIPBOARD_MIME, fragment);
  };
  const renderContextReference = (reference: ChatMarkdownContextReference) => {
    const record = asKnownContextRecord(resolvedContext.recordsById.get(reference.contextId));
    const attachment =
      record?.kind === "image"
        ? (userImages.find((image) => image.id === record.attachmentId) ?? null)
        : null;
    return (
      <span data-thread-find-ignore>
        <UserMessageContextReferenceChip
          reference={reference}
          record={record}
          attachment={attachment}
          onExpandImage={(image) => {
            const preview = buildExpandedImagePreview(userImages, image.id);
            if (preview) onImageExpand(preview);
          }}
        />
      </span>
    );
  };

  const mediaBlock =
    regularImages.length > 0 ? (
      <div
        className={cn(
          "grid",
          !standaloneMedia
            ? "mb-2 max-w-[210px] grid-cols-2 gap-2"
            : loneImage
              ? "max-w-full"
              : collage
                ? cn(
                    MEDIA_EDGE_CLASS_NAME,
                    "w-80 max-w-full gap-px overflow-hidden rounded-2xl bg-black/9 dark:bg-white/12",
                    mediaCornerClassName,
                    regularImages.length === 2
                      ? "auto-rows-[12rem] grid-cols-2"
                      : regularImages.length === 3
                        ? "auto-rows-[calc(6rem-0.5px)] grid-cols-[3fr_2fr]"
                        : "auto-rows-[6rem] grid-cols-2",
                  )
                : "w-80 max-w-full",
        )}
      >
        {regularImages.map((image, index) => (
          <div
            key={image.id}
            className={cn(
              "bg-background/70",
              loneImage
                  ? cn(MEDIA_EDGE_CLASS_NAME, "overflow-hidden rounded-2xl", mediaCornerClassName)
                  : collage
                    ? cn(
                        "overflow-hidden bg-background",
                        regularImages.length === 3 && index === 0 && "row-span-2",
                        regularImages.length > 3 &&
                          regularImages.length % 2 === 1 &&
                          index === regularImages.length - 1 &&
                          "col-span-2",
                      )
                    : standaloneMedia
                      ? cn(MEDIA_EDGE_CLASS_NAME, "aspect-[4/3] overflow-hidden rounded-2xl")
                      : "aspect-[4/3] overflow-hidden rounded-lg border border-border/80",
            )}
          >
            {image.previewUrl ? (
              <button
                type="button"
                className="block h-full w-full cursor-zoom-in"
                aria-label={`Preview ${image.name}`}
                onClick={() => {
                  const preview = buildExpandedImagePreview(regularImages, image.id);
                  if (!preview) return;
                  ctx.onImageExpand(preview);
                }}
              >
                {/* Isolate the thumbnail raster from nearby activity repaints in Chromium. */}
                <AttachmentImage
                  name={image.name}
                  mimeType={image.mimeType}
                  src={image.previewUrl}
                  alt={image.name}
                  decoding="async"
                  loading="lazy"
                  className={cn(
                    "block transform-gpu",
                    loneImage
                        ? "h-48 w-auto min-w-24 max-w-full object-cover"
                        : "size-full object-cover",
                  )}
                />
              </button>
            ) : (
              <div
                className={cn(
                  "flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-2xs text-muted-foreground/70",
                  loneImage && "h-48 w-64 max-w-full",
                  collage && "h-full",
                )}
              >
                {image.name}
              </div>
            )}
          </div>
        ))}
      </div>
    ) : null;

  // Touch shows actions all the time, and narrow lanes have no room beside the
  // bubble, so both keep the actions on their own line.
  const floatActions = row.groupedWithNext === true && !coarsePointer;
  const messageActions = (
    <div
      className={cn(
        "flex items-center justify-end gap-x-2 gap-y-0.5",
        floatActions ? "flex-wrap" : "shrink-0",
      )}
    >
      <Tooltip>
        <TooltipTrigger render={<p className="text-muted-foreground text-xs tabular-nums" />}>
          {formatDayAwareTimestamp(row.message.createdAt, ctx.timestampFormat)}
        </TooltipTrigger>
        <TooltipPopup>
          {formatChatTimestampTooltip(row.message.createdAt, ctx.timestampFormat)}
        </TooltipPopup>
      </Tooltip>
      <div className={cn("flex items-center gap-0.5", floatActions && "flex-wrap justify-end")}>
        {row.rewindable === true && (
          <RevertUserMessageButton messageId={row.message.id} />
        )}
        {copyText && (
          <MessageCopyButton
            text={contextClipboardFragment ? copyText : plainText}
            {...(contextClipboardFragment
              ? {
                  extraFlavors: {
                    [COMPOSER_CONTEXT_CLIPBOARD_MIME]: contextClipboardFragment,
                  },
                }
              : {})}
            variant="ghost"
          />
        )}
      </div>
    </div>
  );
  return (
    <div
      className="group @container flex flex-col items-end gap-1"
    >
      {(row.message.inputIntent === "steer" ||
        row.message.inputIntent === "promoted_queued_to_steer") &&
      !row.continuesSteer ? (
        <UserMessageIntentMarker
          intent={row.message.inputIntent}
          unread={row.projectedItem?.item.status === "pending"}
        />
      ) : null}
      {mediaAboveText ? (
        <div className="flex max-w-[80%] justify-end">
          {/* The heading leads the media so screen readers reach it before the images. */}
          <MessageAuthorHeading>You</MessageAuthorHeading>
          {mediaBlock}
        </div>
      ) : null}
      <div
        className={cn(
          "relative min-w-0 max-w-[80%] rounded-2xl text-message-foreground",
          (mediaAboveText || row.groupedWithPrevious) && "rounded-tr-md",
          row.groupedWithNext && "rounded-br-md",
          BUBBLE_CHIP_CLASS_NAME,
          !mediaOnly && "bg-message p-3",
        )}
      >
        {mediaAboveText ? null : <MessageAuthorHeading>You</MessageAuthorHeading>}
        <div dir={markdownProseDirection(resolvedContext.text)}>
          {!mediaAboveText && mediaBlock}
          <div onCopyCapture={onBodyCopyCapture}>
            <CollapsibleUserMessageBody
              text={resolvedContext.text}
              renderContextReference={renderContextReference}
              skills={ctx.skills}
              markdownCwd={ctx.markdownCwd}
              collapsible
            />
          </div>
        </div>
        {floatActions ? (
          <div
            className={cn(
              "absolute end-full top-1/2 me-2 hidden w-max max-w-[calc(20cqw-0.5rem)] -translate-y-1/2 @min-[37rem]:flex",
              ACTIONS_REVEAL_CLASS_NAME,
            )}
          >
            {messageActions}
          </div>
        ) : null}
      </div>
      <UserMessageProjectedStatus row={row} />
      <div
        className={cn(
          "flex w-full max-w-[80%] justify-end pe-1",
          floatActions && "@min-[37rem]:hidden",
          ACTIONS_REVEAL_CLASS_NAME,
        )}
      >
        {messageActions}
      </div>
    </div>
  );
}

const ACTIONS_REVEAL_CLASS_NAME =
  "items-center text-xs tabular-nums opacity-0 transition-opacity duration-200 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover:opacity-100";

function UserMessageIntentMarker({
  intent,
  unread,
}: {
  readonly intent: "steer" | "promoted_queued_to_steer";
  readonly unread: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className="me-1 flex items-center justify-end gap-1 text-xs leading-none text-muted-foreground"
            data-user-message-intent={intent}
          />
        }
      >
        <Redo2Icon aria-hidden="true" className="size-3" />
        {unread ? "Steer · waiting to be read" : "Steer"}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {unread
          ? "Waiting for the agent to read this. It reads steers between steps, after a running command finishes."
          : intent === "promoted_queued_to_steer"
            ? "Originally queued, then promoted to steer the active turn"
            : "Steered the active turn"}
      </TooltipPopup>
    </Tooltip>
  );
}

function RevertUserMessageButton({ messageId }: { messageId: MessageId }) {
  const ctx = use(TimelineRowCtx);
  const activity = use(TimelineRowActivityCtx);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={activity.isRevertingCheckpoint || activity.isWorking}
            onClick={() => ctx.onRewindToMessage(messageId)}
            aria-label="Edit from here"
          />
        }
      >
        <PencilIcon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup side="top">Edit from here</TooltipPopup>
    </Tooltip>
  );
}

const COLLAPSED_USER_MESSAGE_FADE_HEIGHT_REM = 1.75;

const COLLAPSED_USER_MESSAGE_FADE_MASK = `linear-gradient(to bottom, black calc(100% - ${COLLAPSED_USER_MESSAGE_FADE_HEIGHT_REM}rem), transparent)`;

const CollapsibleUserMessageBody = memo(function CollapsibleUserMessageBody(props: {
  text: string;
  renderContextReference: (reference: ChatMarkdownContextReference) => ReactNode;
  skills: ReadonlyArray<ServerProviderSkill>;
  markdownCwd: string | undefined;
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const revealForFind = () => setExpanded(true);
  const revealRef = findRevealRef(revealForFind);
  const hasVisibleBody = props.text.trim().length > 0;
  const canCollapse =
    props.collapsible !== false && hasVisibleBody && shouldCollapseUserMessage(props.text);
  const isCollapsed = canCollapse && !expanded;
  const showCollapseControl = canCollapse;

  return (
    <div>
      {hasVisibleBody ? (
        <div
          ref={revealRef}
          className={cn("relative", isCollapsed && "max-h-44 overflow-hidden")}
          data-user-message-body="true"
          data-thread-find-text="true"
          data-thread-find-fold={isCollapsed ? "" : undefined}
          data-user-message-collapsed={isCollapsed ? "true" : "false"}
          data-user-message-collapsible={canCollapse ? "true" : "false"}
          data-user-message-fade={isCollapsed ? "true" : "false"}
          style={
            isCollapsed
              ? {
                  WebkitMaskImage: COLLAPSED_USER_MESSAGE_FADE_MASK,
                  maskImage: COLLAPSED_USER_MESSAGE_FADE_MASK,
                }
              : undefined
          }
        >
          <UserMessageBody
            text={props.text}
            renderContextReference={props.renderContextReference}
            skills={props.skills}
            markdownCwd={props.markdownCwd}
          />
        </div>
      ) : null}
      {showCollapseControl ? (
        <div className="mt-1.5 flex items-center justify-end gap-2" data-user-message-footer="true">
          {showCollapseControl ? (
            <Button
              type="button"
              size="xs"
              variant="ghost-muted"
              aria-expanded={expanded}
              data-scroll-anchor-ignore
              onClick={() => setExpanded((value) => !value)}
              className="-ml-1"
            >
              {expanded ? "Show less" : "Show full message"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

const USER_MESSAGE_REMARK_PLUGINS = [remarkEnableOrderedListNumbers];

const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  renderContextReference?: (reference: ChatMarkdownContextReference) => ReactNode;
  skills: ReadonlyArray<ServerProviderSkill>;
  markdownCwd: string | undefined;
}) {
  const ctx = use(TimelineRowCtx);
  if (props.text.length === 0) {
    return null;
  }
  return (
    <ChatMarkdown
      text={props.text}
      cwd={props.markdownCwd}
      threadRef={ctx.threadRef ?? undefined}
      skills={props.skills}
      className="text-foreground user-message-markdown"
      lineBreaks
      parseRawHtml={false}
      extraRemarkPlugins={USER_MESSAGE_REMARK_PLUGINS}
      renderContextReference={props.renderContextReference}
      headingLevelOffset={MESSAGE_HEADING_LEVEL}
    />
  );
});
