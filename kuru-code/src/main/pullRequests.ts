// T3 Code's pull request service (src/main/t3, from its server's pullRequest/ and the GitHub
// source control package), answering the window's `pullRequests.*` RPCs as T3 Code's server
// does (its ws.ts). kuru code reads GitHub with the `gh` login and the projects in its store.
import { join } from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Cause from "effect/Cause";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as RpcSchema from "effect/rpc/RpcSchema";
import type { LogOutputChannel } from "vscode";
import {
  PullRequestDiffInput,
  PullRequestDiffResult,
  WsRpcGroup,
  type PullRequestLinkedThreadsResult,
  type PullRequestRef,
  type RepositoryIdentity,
} from "~/contracts";
import type { AppState } from "@shared/protocol";

import * as ProjectService from "./t3/server/project/ProjectService";
import * as RepositoryIdentityResolver from "./t3/server/project/RepositoryIdentityResolver";
import * as PullRequestFilesViewed from "./t3/server/persistence/PullRequestFilesViewed";
import * as PullRequestProviderRegistry from "./t3/server/pullRequest/PullRequestProviderRegistry";
import * as PullRequestReadCache from "./t3/server/pullRequest/PullRequestReadCache";
import * as PullRequestService from "./t3/server/pullRequest/PullRequestService";
import * as VcsProcess from "./t3/server/vcs/VcsProcess";
import * as SourceControlHost from "./t3/source-control-core/server/SourceControlHost";
import * as SourceControlRateLimit from "./t3/source-control-core/server/SourceControlRateLimit";

type Answer = { ok: true; value: unknown } | { ok: false; error: unknown; unsupported?: boolean };

/** T3 Code's server reaches git and the host CLIs through this; kuru code runs them itself. */
const sourceControlHostLayer = Layer.effect(
  SourceControlHost.SourceControlHost,
  Effect.gen(function* () {
    const process = yield* VcsProcess.VcsProcess;
    return { process: { run: process.run } };
  }),
).pipe(Layer.provide(VcsProcess.layer));

const sameThreadPullRequest = (url: string, ref: PullRequestRef) => {
  const parsed = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return (
    parsed !== null &&
    Number(parsed[3]) === ref.number &&
    parsed[2]!.toLowerCase() === ref.repository.toLowerCase() &&
    (ref.host === undefined || parsed[1]!.toLowerCase() === ref.host.toLowerCase())
  );
};

export function createPullRequests(options: {
  userData: string;
  app: () => AppState;
  log: LogOutputChannel;
}) {
  const { log } = options;
  const services = PullRequestService.layer.pipe(
    Layer.provide(PullRequestProviderRegistry.layer),
    Layer.provide(ProjectService.layer(() => options.app().projects)),
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provide(PullRequestFilesViewed.layer(join(options.userData, "pull-request-files-viewed.json"))),
    Layer.provide(PullRequestReadCache.layer(join(options.userData, "cache", "pull-requests"))),
    Layer.provideMerge(SourceControlRateLimit.layer),
    Layer.provide(sourceControlHostLayer),
    Layer.provide(NodeHttpClient.layerUndici),
    Layer.provide(NodeCrypto.layer),
    Layer.provide(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(services);
  const service = Effect.gen(function* () {
    return yield* PullRequestService.PullRequestService;
  });

  type Handler = (input: any) => Effect.Effect<unknown, unknown, PullRequestService.PullRequestService>;
  const viewer =
    (read: (pullRequests: PullRequestService.PullRequestService["Service"], input: any) => Effect.Effect<unknown, unknown>): Handler =>
    (input) =>
      Effect.flatMap(service, (pullRequests) => pullRequests.withRoutingCredential(input, read(pullRequests, input)));
  const plain =
    (read: (pullRequests: PullRequestService.PullRequestService["Service"], input: any) => Effect.Effect<unknown, unknown>): Handler =>
    (input) =>
      Effect.flatMap(service, (pullRequests) => read(pullRequests, input));

  // T3 Code's ws.ts, but the review guide, which T3 Code writes with its own model calls.
  const unary: Record<string, Handler> = {
    "pullRequests.list": plain((pr, input) => pr.list(input)),
    "pullRequests.listStats": plain((pr, input) => pr.listStats(input)),
    "pullRequests.filterOptions": plain((pr, input) => pr.filterOptions(input)),
    "pullRequests.summary": viewer((pr, input) => pr.summary(input)),
    "pullRequests.stack": viewer((pr, input) => pr.stack(input)),
    // The threads on the pull request's branch (kuru code links a thread to the pull request of
    // the branch it works on), and those it was linked to by hand.
    "pullRequests.linkedThreads": (input: PullRequestRef) =>
      Effect.sync(
        (): PullRequestLinkedThreadsResult => ({
          threads: options
            .app()
            .threads.filter(
              (thread) =>
                (thread.pr !== undefined && sameThreadPullRequest(thread.pr.url, input)) ||
                (thread.links ?? []).some((link) => sameThreadPullRequest(link.url, input)),
            )
            .map((thread) => ({
              id: thread.id as PullRequestLinkedThreadsResult["threads"][number]["id"],
              projectId: (thread.projectId ?? "scratch") as PullRequestLinkedThreadsResult["threads"][number]["projectId"],
              title: thread.title ?? "New thread",
              archivedAt: thread.archivedAt === undefined ? null : new Date(thread.archivedAt).toISOString(),
              settled: thread.settled,
            })),
        }),
      ),
    "pullRequests.detail": viewer((pr, input) => pr.detail(input)),
    "pullRequests.preview": viewer((pr, input) => pr.preview(input)),
    "pullRequests.checks": viewer((pr, input) => pr.checks(input)),
    "pullRequests.activity": viewer((pr, input) => pr.activity(input)),
    "pullRequests.threadComments": viewer((pr, input) => pr.threadComments(input)),
    "pullRequests.diffFileContents": viewer((pr, input) => pr.diffFileContents(input)),
    "pullRequests.filesViewed": viewer((pr, input) => pr.filesViewed(input)),
    "pullRequests.changeBreakdown": viewer((pr, input) => pr.changeBreakdown(input)),
    "pullRequests.setFilesViewed": viewer((pr, input) => pr.setFilesViewed(input)),
    "pullRequests.runAction": viewer((pr, input) => pr.runAction(input)),
    "pullRequests.update": viewer((pr, input) => pr.update(input)),
    "pullRequests.comment": viewer((pr, input) => pr.comment(input)),
    "pullRequests.updateComment": viewer((pr, input) => pr.updateComment(input)),
    "pullRequests.submitReview": viewer((pr, input) => pr.submitReview(input)),
    "pullRequests.replyToThread": viewer((pr, input) => pr.replyToThread(input)),
    "pullRequests.setThreadResolution": viewer((pr, input) => pr.setThreadResolution(input)),
    "pullRequests.setReaction": viewer((pr, input) => pr.setReaction(input)),
    "pullRequests.invalidate": plain((pr, input) => pr.invalidate(input, { notifyReaders: true })),
    "pullRequests.reviewerCandidates": viewer((pr, input) => pr.reviewerCandidates(input)),
    "pullRequests.requestReviewers": viewer((pr, input) => pr.requestReviewers(input)),
    "pullRequests.labelCandidates": viewer((pr, input) => pr.labelCandidates(input)),
    "pullRequests.setLabels": viewer((pr, input) => pr.setLabels(input)),
  };

  const streams: Record<string, (input: any) => Stream.Stream<unknown, unknown, PullRequestService.PullRequestService>> = {
    "pullRequests.subscribeRefreshes": () => Stream.unwrap(Effect.map(service, (pullRequests) => pullRequests.subscribeRefreshes)),
  };

  // oxlint-disable-next-line typescript/no-explicit-any
  const rpcByTag = WsRpcGroup.requests as ReadonlyMap<string, any>;

  /** An error as its RPC's error schema encodes it; anything else is a defect, logged. */
  const encodeFailure = (tag: string, cause: Cause.Cause<unknown>): Answer => {
    const rpc = rpcByTag.get(tag);
    const error = Cause.findErrorOption(cause);
    if (Option.isSome(error)) {
      const encoded = Schema.encodeUnknownExit(rpc.errorSchema)(error.value);
      if (Exit.isSuccess(encoded)) return { ok: false, error: encoded.value };
    }
    log.warn(`rpc ${tag} failed: ${Cause.pretty(cause)}`);
    return { ok: false, error: Cause.pretty(cause), unsupported: true };
  };

  return {
    handles: (tag: string) => tag in unary,

    /** The repository of the folder `cwd`, as T3 Code's projects carry it; `null` without one. */
    repositoryIdentity(cwd: string): Promise<RepositoryIdentity | null> {
      return runtime.runPromise(
        Effect.flatMap(RepositoryIdentityResolver.RepositoryIdentityResolver, (resolver) => resolver.resolve(cwd)),
      );
    },
    streams: (tag: string) => tag in streams,

    async call(tag: string, payload: unknown): Promise<Answer> {
      const rpc = rpcByTag.get(tag);
      const exit = await runtime.runPromiseExit(
        Schema.decodeUnknownEffect(rpc.payloadSchema)(payload).pipe(
          Effect.flatMap((input) => unary[tag]!(input)),
          Effect.flatMap((value) => Schema.encodeUnknownEffect(rpc.successSchema)(value)),
        ),
      );
      return Exit.isSuccess(exit) ? { ok: true, value: exit.value ?? null } : encodeFailure(tag, exit.cause);
    },

    /** Emits each value encoded; returns its teardown. */
    subscribe(tag: string, payload: unknown, emit: (value: unknown) => void, end: (error?: unknown) => void): () => void {
      const rpc = rpcByTag.get(tag);
      const { success } = RpcSchema.isStreamSchema(rpc.successSchema)
        ? { success: rpc.successSchema.success }
        : { success: rpc.successSchema };
      const fiber = runtime.runFork(
        Schema.decodeUnknownEffect(rpc.payloadSchema)(payload).pipe(
          Effect.flatMap((input) =>
            streams[tag]!(input).pipe(
              Stream.mapEffect((value) => Schema.encodeUnknownEffect(success)(value)),
              Stream.runForEach((value) => Effect.sync(() => emit(value))),
            ),
          ),
        ),
      );
      fiber.addObserver((exit) => {
        if (Exit.isSuccess(exit)) end();
        else if (!Cause.hasInterruptsOnly(exit.cause)) {
          const answer = encodeFailure(tag, exit.cause);
          end(answer.ok ? undefined : answer.error);
        }
      });
      return () => void runtime.runFork(Fiber.interrupt(fiber));
    },

    /**
     * A pull request's diff, which T3 Code's server serves over HTTP rather than as an RPC
     * (rt/state/pullRequestDiffHttp.ts). Fails with the reason as its message.
     */
    async diff(payload: unknown): Promise<unknown> {
      const exit = await runtime.runPromiseExit(
        Schema.decodeUnknownEffect(PullRequestDiffInput)(payload).pipe(
          Effect.flatMap((input) =>
            Effect.flatMap(service, (pullRequests) => pullRequests.withRoutingCredential(input, pullRequests.diff(input))),
          ),
          Effect.flatMap(Schema.encodeEffect(PullRequestDiffResult)),
        ),
      );
      if (Exit.isSuccess(exit)) return exit.value;
      const error = Cause.findErrorOption(exit.cause);
      if (Option.isNone(error)) log.warn(`pullRequests.diff failed: ${Cause.pretty(exit.cause)}`);
      throw new Error(
        Option.isSome(error) && error.value instanceof Error ? error.value.message : "The pull request's diff could not be read.",
      );
    },

    dispose: () => runtime.dispose(),
  };
}
