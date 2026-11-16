// From T3 Code's client-runtime state/pullRequestDiffHttp.ts. T3 Code fetched a pull request's
// diff from its server over HTTP; kuru code's main process reads it (with `gh`) over IPC.
import { PullRequestDiffResult, type PullRequestDiffInput } from "~/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { invoke } from "~/bridge";

export class PullRequestDiffReadError extends Schema.TaggedError<PullRequestDiffReadError>()(
  "PullRequestDiffReadError",
  { message: Schema.String },
) {}

export type PullRequestDiffLoadError = PullRequestDiffReadError;

const decodeDiff = Schema.decodeUnknownEffect(PullRequestDiffResult);

export const loadPullRequestDiff = Effect.fn("PullRequests.loadDiff")(function* (
  input: PullRequestDiffInput,
) {
  const raw = yield* Effect.tryPromise({
    try: () => invoke<unknown>("pullRequests.diff", input),
    catch: (cause) =>
      new PullRequestDiffReadError({
        message: cause instanceof Error ? cause.message : "The pull request's diff could not be read.",
      }),
  });
  return yield* decodeDiff(raw).pipe(
    Effect.mapError(
      () => new PullRequestDiffReadError({ message: "The pull request's diff was not understood." }),
    ),
  );
});
