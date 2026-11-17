import {
  ChatImageAttachment,
  ChatFileAttachment,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
} from "./chatAttachment";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas";

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const ProviderInteractionMode = Schema.Literals(["default", "plan"]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;

export const ProviderRequestKind = Schema.Literals([
  "command",
  "file-read",
  "file-change",
  "mcp-elicitation",
  "permission",
]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;

export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "acceptAlways",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;

// Why an approval reached the user although the thread runs with full access:
// the user's own ask rule, or a check the provider enforces even when bypassed.
export const ProviderApprovalFullAccessOverride = Schema.Literals(["ask_rule", "provider_check"]);
export type ProviderApprovalFullAccessOverride = typeof ProviderApprovalFullAccessOverride.Type;

export const ProviderApprovalOption = Schema.Struct({
  decision: ProviderApprovalDecision,
  label: TrimmedNonEmptyString,
  warning: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderApprovalOption = typeof ProviderApprovalOption.Type;

export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const UserInputAttachments = Schema.Record(
  Schema.String,
  Schema.Array(Schema.Union([ChatImageAttachment, ChatFileAttachment])).pipe(
    Schema.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS)),
  ),
);
export type UserInputAttachments = typeof UserInputAttachments.Type;

export const UserInputAttachmentAnswerPayload = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  questionTextById: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  answers: ProviderUserInputAnswers,
  attachmentsByQuestionId: UserInputAttachments,
});
export type UserInputAttachmentAnswerPayload = typeof UserInputAttachmentAnswerPayload.Type;
