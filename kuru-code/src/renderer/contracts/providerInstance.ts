import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas";

/** From T3 Code's providerInstance.ts: an agent provider's id (an Unharnessed provider's name). */
export const ProviderInstanceId = TrimmedNonEmptyString.pipe(Schema.brand("ProviderInstanceId"));
export type ProviderInstanceId = typeof ProviderInstanceId.Type;

/** From T3 Code's pullRequest.ts. */
import { PullRequestMergeMethod } from "./pullRequest";

