// T3 Code's browser/openFileInPreview.ts: files and pages open in its preview
// browser. kuru code has none, so each says so and the caller falls back.
import * as Schema from "effect/Schema";

export class BrowserPreviewUnavailableError extends Schema.TaggedError<BrowserPreviewUnavailableError>()(
  "BrowserPreviewUnavailableError",
  { message: Schema.String },
) {}

export function isBrowserPreviewFile(_path: string): boolean {
  return false;
}

export function isBrowserSettingsReadError(_error: unknown): boolean {
  return false;
}

const unavailable = () =>
  Promise.reject(new BrowserPreviewUnavailableError({ message: "kuru code has no preview browser." }));

export const openFileInPreview = (..._args: ReadonlyArray<unknown>): Promise<never> => unavailable();
export const openUrlInPreview = (..._args: ReadonlyArray<unknown>): Promise<never> => unavailable();
