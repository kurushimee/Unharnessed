import * as Schema from "effect/Schema";

const SpeechCustomWord = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50));
export const SpeechCustomWords = Schema.Array(
  Schema.Struct({
    term: SpeechCustomWord,
    aliases: Schema.Array(SpeechCustomWord).check(Schema.isMaxLength(8)),
  }),
).check(
  Schema.isMaxLength(100),
  Schema.makeFilter((entries) => {
    const spellings = entries.flatMap(({ term, aliases }) => [term, ...aliases]);
    const keys = spellings.map((spelling) => spelling.trim().normalize("NFC").toLocaleLowerCase());
    return keys.every(Boolean) && new Set(keys).size === keys.length
      ? true
      : "Dictionary terms and aliases must be unique and nonempty.";
  }),
);
export type SpeechCustomWords = typeof SpeechCustomWords.Type;

export const SpeechAcceleration = Schema.Union([
  Schema.Literal("auto"),
  Schema.Literal("cpu"),
  Schema.String.check(Schema.isPattern(/^gpu:.+/), Schema.isMaxLength(500)),
]);
export type SpeechAcceleration = typeof SpeechAcceleration.Type;

export const SpeechModelUnloadTimeout = Schema.Literals([
  "never",
  "immediately",
  "min_2",
  "min_5",
  "min_10",
  "min_15",
  "hour_1",
]);
export type SpeechModelUnloadTimeout = typeof SpeechModelUnloadTimeout.Type;

export const SpeechLanguage = Schema.String.check(Schema.isMinLength(2), Schema.isMaxLength(16));
export type SpeechLanguage = typeof SpeechLanguage.Type;

export const SpeechPostProcessingPromptSettings = Schema.Struct({
  mode: Schema.Literals(["default", "custom"]),
  customInstructions: Schema.String.check(Schema.isMaxLength(10_000)),
});
export type SpeechPostProcessingPromptSettings = typeof SpeechPostProcessingPromptSettings.Type;

/** A word the person says to flag a spoken correction, such as "sorry" or "err". */
export const SpeechCorrectionCue = Schema.String.check(Schema.isMaxLength(50));

