import { capitalizeTerm, sourceControlClients } from "~/rt/sourceControlClients";
import {
  COMPOSER_CONTEXT_REVIEW_DIFF_MAX_CHARS,
  COMPOSER_CONTEXT_REVIEW_TEXT_MAX_CHARS,
} from "~/contracts";
import type {
  ComposerContextId,
  ComposerContextRecord,
  EnvironmentId,
  FileContextRecord,
  ImageContextRecord,
  KnownComposerContextRecord,
  MessageId,
  OrchestrationMessageContext,
  ReviewCommentContextRecord,
  ThreadContextRecord,
  ThreadId,
} from "~/contracts";
import { encodeComposerContextFragment } from "~/shared/composerContextClipboard";
import {
  collectComposerContextReferences,
  sanitizeComposerContextLabel,
  toKindScopedComposerContextId,
} from "~/shared/composerContextReferences";

import { type ComposerContextReference, producerIdFromComposerContextId } from "./composerContextReferences";
import type { ComposerFileAttachment, ComposerImageAttachment } from "~/composerDraftStore";
import type { ReviewCommentContext } from "~/reviewCommentContext";

// Truncate selections to wire bounds before persistence to avoid send-time encoding failures.
const TRUNCATION_MARKER = "\n… truncated …";

function clampContextText(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = Math.max(0, max - TRUNCATION_MARKER.length);
  // Never end on a lone high surrogate.
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${value.slice(0, end)}${TRUNCATION_MARKER}`;
}

type ReviewCommentPresentation = ReviewCommentContext | ReviewCommentContextRecord;

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath;
}

export function reviewCommentContextLabel(comment: ReviewCommentPresentation): string {
  const pullRequestNumber = pullRequestContextNumber(comment);
  if (isPullRequestSummaryContext(comment) && pullRequestNumber !== null) {
    return `#${pullRequestNumber}`;
  }
  const diffRange = /^([+-])(\d+)(?: to \1(\d+))?$/u.exec(comment.rangeLabel);
  const rangeLabel = diffRange
    ? `L${diffRange[2]}${diffRange[3] ? ` to L${diffRange[3]}` : ""}${diffRange[1] === "-" ? " (before)" : ""}`
    : comment.rangeLabel;
  const sectionPullRequest = /^pull-request:(\d+)$/u.exec(comment.sectionId)?.[1];
  const prefix = sectionPullRequest === undefined ? "" : `#${sectionPullRequest} `;
  return `${prefix}${basename(comment.filePath)} ${rangeLabel}`;
}

export function isPullRequestSummaryContext(comment: ReviewCommentPresentation): boolean {
  if (comment.pullRequest !== undefined) return true;
  return (
    comment.sectionId.startsWith("pull-request:") &&
    comment.diff.trim().length === 0 &&
    /^PR #\d+$/u.test(comment.filePath)
  );
}

function pullRequestContextNumber(comment: ReviewCommentPresentation): number | null {
  if (comment.pullRequest !== undefined) return comment.pullRequest.number;
  const legacyNumber = /^PR #(\d+)$/u.exec(comment.filePath)?.[1];
  return legacyNumber === undefined ? null : Number(legacyNumber);
}

export type PullRequestContextDisplayState = "open" | "draft" | "merged" | "closed";

export function pullRequestContextDisplayState(
  comment: ReviewCommentPresentation,
): PullRequestContextDisplayState | null {
  const pullRequest = comment.pullRequest;
  if (pullRequest === undefined) return null;
  return pullRequest.state === "open" && pullRequest.isDraft ? "draft" : pullRequest.state;
}

export function pullRequestContextKindLabel(comment: ReviewCommentPresentation): string {
  const url = comment.pullRequest?.url;
  const host = url === undefined ? null : sourceControlClients.findByChangeRequestUrl(url);
  const term = (host ?? sourceControlClients.get(undefined)).changeRequest.singular;
  const state = pullRequestContextDisplayState(comment);
  if (state === null) return capitalizeTerm(term);
  return `${capitalizeTerm(state)} ${term}`;
}

export function reviewCommentContextId(commentId: string): ComposerContextId {
  return toKindScopedComposerContextId("review-comment", commentId);
}

export function reviewCommentContextReference(
  comment: ReviewCommentContext,
): ComposerContextReference {
  return {
    kind: "review-comment",
    contextId: reviewCommentContextId(comment.id),
    label: reviewCommentContextLabel(comment),
  };
}

export function threadContextReference(record: ThreadContextRecord): ComposerContextReference {
  return { kind: "thread", contextId: record.contextId, label: record.label };
}

export function reviewCommentContextRecord(
  comment: ReviewCommentContext,
): ReviewCommentContextRecord {
  return {
    version: 1,
    contextId: reviewCommentContextId(comment.id),
    kind: "review-comment",
    label: sanitizeComposerContextLabel(reviewCommentContextLabel(comment), "review-comment"),
    sectionId: comment.sectionId,
    sectionTitle: comment.sectionTitle,
    filePath: comment.filePath,
    startIndex: comment.startIndex,
    endIndex: comment.endIndex,
    rangeLabel: comment.rangeLabel,
    text: clampContextText(comment.text, COMPOSER_CONTEXT_REVIEW_TEXT_MAX_CHARS),
    diff: clampContextText(comment.diff, COMPOSER_CONTEXT_REVIEW_DIFF_MAX_CHARS),
    ...(comment.fenceLanguage !== undefined ? { fenceLanguage: comment.fenceLanguage } : {}),
    ...(comment.pullRequest !== undefined ? { pullRequest: comment.pullRequest } : {}),
  };
}

export function imageContextReference(image: ComposerImageAttachment): ComposerContextReference {
  return {
    kind: "image",
    contextId: toKindScopedComposerContextId("image", image.id),
    label: image.name,
  };
}

export function fileContextReference(file: ComposerFileAttachment): ComposerContextReference {
  return {
    kind: "file",
    contextId: toKindScopedComposerContextId("file", file.id),
    label: file.name,
  };
}

export interface BoundComposerAttachment {
  attachment: ComposerImageAttachment | ComposerFileAttachment;
  attachmentId: string;
}

export function attachmentContextRecord(
  bound: BoundComposerAttachment,
): ImageContextRecord | FileContextRecord {
  const { attachment, attachmentId } = bound;
  const base = {
    version: 1 as const,
    contextId: toKindScopedComposerContextId(attachment.type, attachment.id),
    label: sanitizeComposerContextLabel(attachment.name, attachment.type),
    attachmentId,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  };
  return attachment.type === "image" ? { ...base, kind: "image" } : { ...base, kind: "file" };
}

export function buildMessageContext(input: {
  reviewComments: ReadonlyArray<ReviewCommentContext>;
  threadContexts?: ReadonlyArray<ThreadContextRecord>;
  attachments?: ReadonlyArray<BoundComposerAttachment>;
}): OrchestrationMessageContext | undefined {
  const records: ComposerContextRecord[] = [
    ...input.reviewComments.map(reviewCommentContextRecord),
    ...(input.threadContexts ?? []),
    ...(input.attachments ?? []).map(attachmentContextRecord),
  ];
  return records.length === 0 ? undefined : { version: 1, records };
}

export function asKnownContextRecord(
  record: ComposerContextRecord | undefined,
): KnownComposerContextRecord | undefined {
  if (!record || "payload" in record) return undefined;
  return record;
}

export function composerContextImportLookupIds(
  record: KnownComposerContextRecord,
): ReadonlyArray<ComposerContextId> {
  const destinationId = toKindScopedComposerContextId(
    record.kind,
    producerIdFromComposerContextId(record.kind, record.contextId),
  );
  return destinationId === record.contextId
    ? [record.contextId]
    : [destinationId, record.contextId];
}

export interface ResolvedUserMessageContext {
  text: string;
  records: ReadonlyArray<ComposerContextRecord>;
  recordsById: ReadonlyMap<string, ComposerContextRecord>;
}

export function selectedMessageContextFragment(input: {
  readonly markdown: string;
  readonly records: ReadonlyArray<ComposerContextRecord>;
  readonly environmentId: EnvironmentId;
  readonly threadId?: ThreadId;
  readonly messageId: MessageId;
}): string | null {
  const selectedIds = new Set(
    collectComposerContextReferences(input.markdown).map((occurrence) => occurrence.contextId),
  );
  const records = input.records.filter((record) => selectedIds.has(record.contextId));
  if (records.length === 0) return null;
  return encodeComposerContextFragment({
    version: 1,
    source: {
      environmentId: input.environmentId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      messageId: input.messageId,
    },
    records,
  });
}

export function resolveUserMessageContext(message: {
  text: string;
  context?: OrchestrationMessageContext | undefined;
}): ResolvedUserMessageContext {
  const resolved = { text: message.text, records: message.context?.records ?? [] };
  return {
    text: resolved.text,
    records: resolved.records,
    recordsById: new Map(resolved.records.map((record) => [record.contextId, record])),
  };
}

export function reviewCommentFromRecord(record: ReviewCommentContextRecord): ReviewCommentContext {
  return {
    id: producerIdFromComposerContextId("review-comment", record.contextId),
    sectionId: record.sectionId,
    sectionTitle: record.sectionTitle,
    filePath: record.filePath,
    startIndex: record.startIndex,
    endIndex: record.endIndex,
    rangeLabel: record.rangeLabel,
    text: record.text,
    diff: record.diff,
    ...(record.fenceLanguage !== undefined ? { fenceLanguage: record.fenceLanguage } : {}),
    ...(record.pullRequest !== undefined ? { pullRequest: record.pullRequest } : {}),
  };
}

/** Labels are display-only; folded ids can collide, so paste deduplication compares payloads. */
export function isSameComposerContextPayload(
  left: ComposerContextRecord,
  right: ComposerContextRecord,
): boolean {
  if (left.kind !== right.kind) return false;
  const stableKey = (record: ComposerContextRecord) => {
    const { label: _label, contextId: _contextId, ...rest } = record;
    const sortDeep = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sortDeep);
      if (value === null || typeof value !== "object") return value;
      return Object.fromEntries(
        Object.entries(value)
          .toSorted(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
          .map(([key, nested]) => [key, sortDeep(nested)]),
      );
    };
    return JSON.stringify(sortDeep(rest));
  };
  return stableKey(left) === stableKey(right);
}
