// From T3 Code's client-runtime state/pullRequestRouting.ts. T3 Code routed a pull request's
// reads and writes to whichever of its environments could reach its repository; kuru code's one
// environment, this machine, answers every pull request itself (with `gh`).
import * as Effect from "effect/Effect";

import {
  requestGuarded as request,
  type EnvironmentRpcInput,
  type EnvironmentUnaryRpcTag,
} from "../rpc/client";

export function createPullRequestRouter() {
  return Effect.fn("PullRequestRouting.request")(function* <T extends EnvironmentUnaryRpcTag>(
    tag: T,
    input: EnvironmentRpcInput<T>,
    sourceRead?: ReturnType<typeof request<T>>,
  ) {
    return yield* sourceRead ?? request(tag, input);
  });
}
