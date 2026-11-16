import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { SourceControlProviderKind } from "~/contracts";

export const PullRequestFilesViewedScope = Schema.Struct({
  provider: SourceControlProviderKind,
  host: Schema.String,
  repository: Schema.String,
  number: Schema.Int,
  viewer: Schema.String,
});
export type PullRequestFilesViewedScope = typeof PullRequestFilesViewedScope.Type;

export const PullRequestFileViewedMark = Schema.Struct({
  path: Schema.String,
  /** Empty means the host confirms deletion; null means no baseline, so the mark stays cleared until replaced. */
  revision: Schema.NullOr(Schema.String),
});
export type PullRequestFileViewedMark = typeof PullRequestFileViewedMark.Type;

export interface SetPullRequestFilesViewedInput extends PullRequestFilesViewedScope {
  readonly files: ReadonlyArray<PullRequestFileViewedMark & { readonly viewed: boolean }>;
  readonly viewedAt: string;
}

export const MAX_FILES_VIEWED_ROWS = 500;

export interface PullRequestFilesViewedPage {
  readonly files: ReadonlyArray<PullRequestFileViewedMark>;
  readonly truncated: boolean;
}

export class PullRequestFilesViewedStoreError extends Schema.TaggedError<PullRequestFilesViewedStoreError>()(
  "PullRequestFilesViewedStoreError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class PullRequestFilesViewedRepository extends Context.Service<
  PullRequestFilesViewedRepository,
  {
    readonly list: (
      input: PullRequestFilesViewedScope,
    ) => Effect.Effect<PullRequestFilesViewedPage, PullRequestFilesViewedStoreError>;
    readonly set: (
      input: SetPullRequestFilesViewedInput,
    ) => Effect.Effect<void, PullRequestFilesViewedStoreError>;
  }
>()("t3/persistence/PullRequestFilesViewed/PullRequestFilesViewedRepository") {}

/** Marks by scope key, then by path. kuru code keeps them in one JSON file instead of SQLite. */
const StoredMarks = Schema.Record(
  Schema.String,
  Schema.Record(
    Schema.String,
    Schema.Struct({ revision: Schema.NullOr(Schema.String), viewedAt: Schema.String }),
  ),
);
type StoredMarks = typeof StoredMarks.Type;
const StoredMarksJson = Schema.fromJsonString(StoredMarks);

const scopeKey = (scope: PullRequestFilesViewedScope) =>
  JSON.stringify([scope.provider, scope.host, scope.repository, scope.number, scope.viewer]);

const make = (file: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const writes = yield* Semaphore.make(1);

    const read = (operation: string) =>
      fileSystem.readFileString(file).pipe(
        Effect.flatMap(Schema.decodeEffect(StoredMarksJson)),
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed<StoredMarks>({})),
        Effect.mapError((cause) => new PullRequestFilesViewedStoreError({ operation, cause })),
      );

    return PullRequestFilesViewedRepository.of({
      list: Effect.fn("PullRequestFilesViewedRepository.list")(function* (input) {
        const marks = (yield* read("listPullRequestFilesViewed"))[scopeKey(input)] ?? {};
        const rows = Object.entries(marks)
          .map(([markPath, mark]) => ({ path: markPath, revision: mark.revision }))
          .toSorted((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
        return {
          files: rows.slice(0, MAX_FILES_VIEWED_ROWS),
          truncated: rows.length > MAX_FILES_VIEWED_ROWS,
        };
      }),

      set: (input) =>
        writes.withPermits(1)(
          Effect.gen(function* () {
            const stored = yield* read("setPullRequestFilesViewed");
            const key = scopeKey(input);
            const marks = { ...stored[key] };
            for (const mark of input.files) {
              if (mark.viewed) marks[mark.path] = { revision: mark.revision, viewedAt: input.viewedAt };
              else delete marks[mark.path];
            }
            const next = { ...stored, [key]: marks };
            if (Object.keys(marks).length === 0) delete next[key];
            const text = yield* Schema.encodeEffect(StoredMarksJson)(next);
            yield* fileSystem.makeDirectory(path.dirname(file), { recursive: true });
            yield* fileSystem.writeFileString(`${file}.tmp`, text);
            yield* fileSystem.rename(`${file}.tmp`, file);
          }).pipe(
            Effect.mapError(
              (cause) =>
                new PullRequestFilesViewedStoreError({ operation: "setPullRequestFilesViewed", cause }),
            ),
            Effect.withSpan("PullRequestFilesViewedRepository.set"),
          ),
        ),
    });
  });

/** `file` is the JSON file the marks live in. */
export const layer = (file: string) => Layer.effect(PullRequestFilesViewedRepository, make(file));
