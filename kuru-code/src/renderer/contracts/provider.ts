import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas";

export const ProviderUploadFeedbackResult = Schema.Struct({
  feedbackId: TrimmedNonEmptyString,
});
export type ProviderUploadFeedbackResult = typeof ProviderUploadFeedbackResult.Type;

