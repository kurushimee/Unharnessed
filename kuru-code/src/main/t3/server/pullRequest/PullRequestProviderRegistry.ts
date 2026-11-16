import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { SourceControlProviderKind } from "~/contracts";

import type { PullRequestProviderApi } from "../../source-control-core/server/PullRequestProvider";
import * as GitHubPullRequestApi from "../../source-control-github/server/GitHubPullRequestApi";
import * as GitHubPullRequestProvider from "../../source-control-github/server/GitHubPullRequestProvider";
import * as GitHubRest from "../../source-control-github/server/GitHubRest";

export class PullRequestProviderRegistry extends Context.Service<
  PullRequestProviderRegistry,
  {
    readonly get: (kind: SourceControlProviderKind) => PullRequestProviderApi | null;
    readonly kinds: ReadonlyArray<SourceControlProviderKind>;
  }
>()("t3/pullRequest/PullRequestProviderRegistry") {}

export function fromProviders(
  providers: ReadonlyArray<PullRequestProviderApi>,
): PullRequestProviderRegistry["Service"] {
  const byKind = new Map(providers.map((provider) => [provider.kind, provider]));
  return {
    get: (kind) => byKind.get(kind) ?? null,
    kinds: providers.map((provider) => provider.kind),
  };
}

/** kuru code's one host is GitHub, read with the `gh` login. */
export const make = GitHubPullRequestProvider.make.pipe(Effect.map((github) => fromProviders([github])));

// `GitHubRest.layerWithDependencies` carries the quota reserve every GitHub reader shares, so it
// is built once, here.
export const layer = Layer.effect(PullRequestProviderRegistry, make).pipe(
  Layer.provide(GitHubPullRequestApi.layer),
  Layer.provide(GitHubRest.layerWithDependencies),
);
