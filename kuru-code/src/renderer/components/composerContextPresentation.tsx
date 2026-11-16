import ChatMarkdown from "./ChatMarkdown";
import { ReadOnlySourcePreview } from "./files/AttachmentFilePreview";
import type { ThreadContextRecord } from "~/contracts";
import { formatAttachmentSize } from "~/rt/state/attachments";
import { MessageCircleIcon } from "lucide-react";
import { createContext, type ReactElement, type ReactNode, use } from "react";
import { ComposerContextActionsContext } from "./composerContextActions";

import type { ComposerFileAttachment, ComposerImageAttachment } from "~/composerDraftStore";
import { useTheme } from "~/hooks/useTheme";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import {
  fileContextReference,
  imageContextReference,
  isPullRequestSummaryContext,
  pullRequestContextDisplayState,
  pullRequestContextKindLabel,
  reviewCommentContextId,
  reviewCommentContextLabel,
} from "~/lib/composerContextRecords";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import { ThreadContextChip } from "./ThreadContextChip";
import { createContextPresentationRegistry, type ContextPresentationCapability } from "./contextPresentationRegistry";
import type { ContextChipKind } from "./ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  ContextChipPopover,
  ContextChipShell,
  FileChip,
  ImageChipButton,
  PULL_REQUEST_CHIP_KINDS,
  PullRequestChip,
  UnresolvedChip,
} from "./contextChipParts";

export type ComposerDraftContextRecord =
  | { kind: "review-comment"; record: ReviewCommentContext }
  | { kind: "image"; record: ComposerImageAttachment }
  | { kind: "file"; record: ComposerFileAttachment }
  | { kind: "thread"; record: ThreadContextRecord };

export {
  ComposerContextActionsContext,
  type ComposerContextActions,
} from "./composerContextActions";

export type ComposerDraftContextRecords = ReadonlyMap<string, ComposerDraftContextRecord>;

export const EMPTY_COMPOSER_CONTEXT_RECORDS: ComposerDraftContextRecords = new Map();

export const ComposerContextRecordsContext = createContext<ComposerDraftContextRecords>(
  EMPTY_COMPOSER_CONTEXT_RECORDS,
);

export function composerContextRecordsFromDraft(input: {
  reviewComments?: ReadonlyArray<ReviewCommentContext>;
  threadContexts?: ReadonlyArray<ThreadContextRecord>;
  images?: ReadonlyArray<ComposerImageAttachment>;
  files?: ReadonlyArray<ComposerFileAttachment>;
}): ComposerDraftContextRecords {
  const records = new Map<string, ComposerDraftContextRecord>();
  for (const record of input.images ?? []) {
    records.set(imageContextReference(record).contextId, { kind: "image", record });
  }
  for (const record of input.files ?? []) {
    records.set(fileContextReference(record).contextId, { kind: "file", record });
  }
  for (const record of input.reviewComments ?? []) {
    records.set(reviewCommentContextId(record.id), { kind: "review-comment", record });
  }
  for (const record of input.threadContexts ?? []) {
    records.set(record.contextId, { kind: "thread", record });
  }
  return records;
}

function ContextChip(props: {
  icon: ReactElement;
  label: string;
  kindLabel: string;
  details: ReactNode;
  detailsMode: ContextPresentationCapability["details"];
  kind: ContextChipKind;
}) {
  if (props.detailsMode === "popover") {
    return (
      <ContextChipPopover
        kind={props.kind}
        icon={props.icon}
        label={props.label}
        accessibleLabel={props.kindLabel + ", " + props.label}
      >
        {props.details}
      </ContextChipPopover>
    );
  }
  return (
    <ContextChipShell
      kind={props.kind}
      icon={props.icon}
      label={props.label}
      aria-label={
        props.detailsMode === "tooltip" ? `${props.kindLabel}, ${props.label}` : undefined
      }
      tooltip={props.detailsMode === "tooltip" ? props.details : undefined}
    />
  );
}

function attachmentTooltip(attachment: ComposerImageAttachment | ComposerFileAttachment): string {
  return [attachment.name, formatAttachmentSize(attachment.sizeBytes)].join("\n");
}

function ImageContextChip(props: { record: ComposerImageAttachment }) {
  const actions = use(ComposerContextActionsContext);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ImageChipButton
            name={props.record.name}
            previewUrl={props.record.previewUrl}
            size={formatAttachmentSize(props.record.sizeBytes)}
            suffix={null}
            onClick={() => actions.expandImage(props.record.id)}
          />
        }
      />
      <TooltipPopup side="top" className="whitespace-pre-wrap">
        {attachmentTooltip(props.record)}
      </TooltipPopup>
    </Tooltip>
  );
}

/** A file chip from a draft T3 Code wrote; Unharnessed sends images only, so it opens nothing. */
function FileContextChip(props: { record: ComposerFileAttachment }) {
  const { resolvedTheme } = useTheme();
  const size = formatAttachmentSize(props.record.sizeBytes);
  return (
    <FileChip
      name={props.record.name}
      size={size}
      isVideo={false}
      theme={resolvedTheme}
      error={false}
      unresolved
      suffix="not sent"
      accessibleLabel={`File attachment, ${props.record.name}, ${size}`}
      tooltip={`${props.record.name}: Unharnessed sends images only. Remove it to send.`}
    />
  );
}

function PullRequestContextChip(props: { record: ReviewCommentContext; kind: ContextChipKind }) {
  const actions = use(ComposerContextActionsContext);
  const metadata = props.record.pullRequest;
  if (metadata === undefined) return null;
  return (
    <PullRequestChip
      metadata={metadata}
      environmentId={actions.environmentId}
      label={reviewCommentContextLabel(props.record)}
      kindLabel={pullRequestContextKindLabel(props.record)}
      kind={props.kind}
      onOpen={actions.openPullRequest}
    />
  );
}

function ComposerReviewCommentDetails({ comment }: { comment: ReviewCommentContext }) {
  return (
    <div className="space-y-2 overflow-hidden rounded-lg border border-border/70 bg-background/70 p-3">
      <div className="space-y-1">
        <div className="truncate text-xs font-medium text-foreground">{comment.filePath}</div>
        <div className="text-secondary-label text-2xs">
          {comment.sectionTitle} · {comment.rangeLabel}
        </div>
      </div>
      {comment.text.trim() ? <ChatMarkdown text={comment.text.trim()} cwd={undefined} /> : null}
      {comment.diff.trim() ? (
        <div className="flex h-64 min-h-0 flex-col overflow-hidden rounded-md border border-border">
          <ReadOnlySourcePreview name="review.diff" text={comment.diff} />
        </div>
      ) : null}
    </div>
  );
}

function ComposerThreadContextChip(props: { record: ThreadContextRecord }) {
  return <ThreadContextChip record={props.record} unreadable={false} />;
}

function UnresolvedContextChip(props: { label: string }) {
  return (
    <UnresolvedChip
      label={props.label}
      tooltip="This context is no longer available. Remove it or attach it again."
    />
  );
}

interface ComposerContextRenderContext {
  label: string;
}

const composerContextPresentationRegistry = createContextPresentationRegistry<
  ComposerDraftContextRecord,
  ComposerContextRenderContext,
  ReactElement
>({
  requiredKinds: [
    "image",
    "file",
    "review-comment",
    "thread",
  ],
  handlers: [
    {
      kind: "image",
      canRender: (entry) => entry.kind === "image",
      render: (entry, context) =>
        entry.kind === "image" ? (
          <ImageContextChip record={entry.record} />
        ) : (
          <UnresolvedContextChip label={context.label} />
        ),
    },
    {
      kind: "file",
      canRender: (entry) => entry.kind === "file",
      render: (entry, context) =>
        entry.kind === "file" ? (
          <FileContextChip record={entry.record} />
        ) : (
          <UnresolvedContextChip label={context.label} />
        ),
    },
    {
      kind: "review-comment",
      canRender: (entry) => entry.kind === "review-comment",
      render: (entry, context, definition) => {
        if (entry.kind !== "review-comment") {
          return <UnresolvedContextChip label={context.label} />;
        }
        const isPullRequest = isPullRequestSummaryContext(entry.record);
        const pullRequestState = pullRequestContextDisplayState(entry.record) ?? "unknown";
        if (isPullRequest && entry.record.pullRequest !== undefined) {
          return (
            <PullRequestContextChip
              record={entry.record}
              kind={PULL_REQUEST_CHIP_KINDS[pullRequestState]}
            />
          );
        }
        return (
          <ContextChip
            icon={isPullRequest ? <PullRequestGlyph.pullRequest /> : <MessageCircleIcon />}
            label={reviewCommentContextLabel(entry.record)}
            kindLabel={isPullRequest ? pullRequestContextKindLabel(entry.record) : "Review comment"}
            details={<ComposerReviewCommentDetails comment={entry.record} />}
            detailsMode={definition.capabilities.details}
            kind={isPullRequest ? PULL_REQUEST_CHIP_KINDS[pullRequestState] : "review-comment"}
          />
        );
      },
    },
    {
      kind: "thread",
      canRender: (entry) => entry.kind === "thread",
      render: (entry, context) =>
        entry.kind === "thread" ? (
          <ComposerThreadContextChip record={entry.record} />
        ) : (
          <UnresolvedContextChip label={context.label} />
        ),
    },
  ],
  fallback: (_kind, _entry, context) => <UnresolvedContextChip label={context.label} />,
});

export function ComposerContextReferenceChip(props: {
  kind: string;
  contextId: string;
  label: string;
}): ReactElement {
  const records = use(ComposerContextRecordsContext);
  return composerContextPresentationRegistry.render(props.kind, records.get(props.contextId), {
    label: props.label,
  });
}
