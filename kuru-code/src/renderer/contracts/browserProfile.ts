import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas";

export const BROWSER_PROFILE_NAME_MAX_LENGTH = 48;

/** Control characters could collide with client cache-key delimiters and select another partition. */
export const BrowserProfileId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[^\p{Cc}]+$/u),
);
export type BrowserProfileId = typeof BrowserProfileId.Type;

export const BrowserProfileName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(BROWSER_PROFILE_NAME_MAX_LENGTH),
);

export const BrowserProfileKind = Schema.Literals(["persistent", "incognito"]);
export type BrowserProfileKind = typeof BrowserProfileKind.Type;

export const BrowserProfile = Schema.Struct({
  id: BrowserProfileId,
  name: BrowserProfileName,
  kind: BrowserProfileKind,
});
export type BrowserProfile = typeof BrowserProfile.Type;

export const DEFAULT_BROWSER_PROFILE_ID: BrowserProfileId = "default";

