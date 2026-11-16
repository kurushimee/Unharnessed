// T3 Code's client-runtime rpc/client.ts, for kuru code. T3 Code's window
// sends its RPCs (contracts/rpc.ts) to its server over a WebSocket; kuru code
// sends the same RPCs, by the same tags and schemas, to its main process,
// which answers those Unharnessed has an answer for (src/main/rpc.ts). Values
// cross as the schemas encode them, so dates and branded ids come back whole.
import { type EnvironmentAuthorizationError, type EnvironmentId, ORCHESTRATION_V2_WS_METHODS, WS_METHODS, WsRpcGroup } from "~/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Queue from "effect/Queue";

import { rpcBridge, type RpcEvent } from "~/bridge";
import type { WsRpcProtocolClient } from "./protocol";

export class EnvironmentRpcUnavailableError extends Schema.TaggedError<EnvironmentRpcUnavailableError>()(
  "EnvironmentRpcUnavailableError",
  {
    environmentId: Schema.String,
    message: Schema.String,
  },
) {}

export type EnvironmentRpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends EnvironmentRpcTag> = WsRpcProtocolClient[TTag];

export type EnvironmentSubscriptionRpcTag =
  | typeof WS_METHODS.providerAuthSubscribe
  | typeof WS_METHODS.providerInstallSubscribe
  | typeof ORCHESTRATION_V2_WS_METHODS.subscribeShell
  | typeof ORCHESTRATION_V2_WS_METHODS.subscribeThread
  | typeof ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput
  | typeof ORCHESTRATION_V2_WS_METHODS.subscribePromptSuggestion
  | typeof ORCHESTRATION_V2_WS_METHODS.searchThreadStream
  | typeof WS_METHODS.subscribeAuthAccess
  | typeof WS_METHODS.subscribeServerConfig
  | typeof WS_METHODS.subscribeServerLifecycle
  | typeof WS_METHODS.scheduledTasksSubscribe
  | typeof WS_METHODS.serverGetStorageCleanupReport
  | typeof WS_METHODS.serverGetDatabaseStorage
  | typeof WS_METHODS.subscribeTerminalMetadata
  | typeof WS_METHODS.subscribePreviewEvents
  | typeof WS_METHODS.subscribeDiscoveredLocalServers
  | typeof WS_METHODS.subscribeDeviceState
  | typeof WS_METHODS.subscribeResourceTelemetry
  | typeof WS_METHODS.pullRequestsSubscribeRefreshes
  | typeof WS_METHODS.subscribeVcsStatus
  | typeof WS_METHODS.subscribeVcsBranch
  | typeof WS_METHODS.subscribeWorktreeSetup
  | typeof WS_METHODS.subscribeProjectClones
  | typeof WS_METHODS.terminalAttach
  | typeof WS_METHODS.terminalObserve;

export type EnvironmentStreamCommandRpcTag =
  | typeof WS_METHODS.chatGptHandoffSubscribe
  | typeof WS_METHODS.cloudInstallRelayClient
  | typeof WS_METHODS.serverUpdateServerWithProgress
  | typeof WS_METHODS.gitRunStackedAction;

export type EnvironmentStreamRpcTag =
  | EnvironmentSubscriptionRpcTag
  | EnvironmentStreamCommandRpcTag;

export type EnvironmentUnaryRpcTag = Exclude<EnvironmentRpcTag, EnvironmentStreamRpcTag>;

export type EnvironmentRpcInput<TTag extends EnvironmentRpcTag> = Parameters<RpcMethod<TTag>>[0];

export type EnvironmentRpcSuccess<TTag extends EnvironmentUnaryRpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer A, any, any>
    ? A
    : never;

export type EnvironmentRpcFailure<TTag extends EnvironmentUnaryRpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<any, infer E, any>
    ? E
    : never;

export type EnvironmentRpcStreamValue<TTag extends EnvironmentStreamRpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer A, any, any>
    ? A
    : never;

export type EnvironmentRpcStreamFailure<TTag extends EnvironmentStreamRpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<any, infer E, any>
    ? E
    : never;


/** What kuru code's main process answers an RPC with: its value or its error, encoded. */
type LocalRpcAnswer =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown; readonly unsupported?: boolean };

// oxlint-disable-next-line typescript/no-explicit-any
const rpcByTag = WsRpcGroup.requests as ReadonlyMap<string, any>;

/** T3 Code's RPC, answered by kuru code's main process. */
export function request<TTag extends EnvironmentUnaryRpcTag>(
  tag: TTag,
  input: EnvironmentRpcInput<TTag>,
): Effect.Effect<EnvironmentRpcSuccess<TTag>, EnvironmentRpcFailure<TTag> | EnvironmentRpcUnavailableError> {
  const rpc = rpcByTag.get(tag);
  return Effect.gen(function* (): Generator<any, EnvironmentRpcSuccess<TTag>, any> {
    if (rpc === undefined) {
      return yield* new EnvironmentRpcUnavailableError({ environmentId: "local", message: `No RPC ${tag}.` });
    }
    const payload = yield* Effect.orDie(Schema.encodeUnknownEffect(rpc.payloadSchema)(input));
    const answer = yield* Effect.promise(() => rpcBridge().rpc(tag, payload) as Promise<LocalRpcAnswer>);
    if (answer.ok) {
      return (yield* Effect.orDie(Schema.decodeUnknownEffect(rpc.successSchema)(answer.value))) as EnvironmentRpcSuccess<TTag>;
    }
    if (answer.unsupported) {
      return yield* new EnvironmentRpcUnavailableError({
        environmentId: "local",
        message: String(answer.error),
      });
    }
    const error = yield* Effect.orDie(Schema.decodeUnknownEffect(rpc.errorSchema)(answer.error));
    return yield* Effect.fail(error as EnvironmentRpcFailure<TTag>);
  }) as Effect.Effect<EnvironmentRpcSuccess<TTag>, EnvironmentRpcFailure<TTag> | EnvironmentRpcUnavailableError>;
}

// Streams: the main process sends each value as an "rpc-event" with the
// stream's id, then its end; dropping the stream tells it to stop.
const streamListeners = new Map<string, (event: RpcEvent) => void>();
let listening = false;
let nextStreamId = 0;

function listen(): void {
  if (listening) return;
  listening = true;
  rpcBridge().onRpcEvent((event) => streamListeners.get(event.id)?.(event));
}

/** T3 Code's streaming RPC, answered by kuru code's main process. */
export function subscribe<TTag extends EnvironmentStreamRpcTag>(
  tag: TTag,
  input: EnvironmentRpcInput<TTag>,
): Stream.Stream<EnvironmentRpcStreamValue<TTag>, EnvironmentRpcStreamFailure<TTag>> {
  // An RPC kuru code does not answer ends its stream with EnvironmentRpcUnavailableError,
  // as T3 Code's do when their server is too old to have it.
  const rpc = rpcByTag.get(tag);
  // oxlint-disable-next-line typescript/no-explicit-any
  return Stream.callback<any, any>((queue) =>
    Effect.gen(function* () {
      if (rpc === undefined) {
        return yield* new EnvironmentRpcUnavailableError({ environmentId: "local", message: `No RPC ${tag}.` });
      }
      const payload = yield* Effect.orDie(Schema.encodeUnknownEffect(rpc.payloadSchema)(input));
      const decodeValue = Schema.decodeUnknownSync(rpc.successSchema);
      const decodeError = Schema.decodeUnknownSync(rpc.errorSchema);
      listen();
      const id = `s${++nextStreamId}`;
      streamListeners.set(id, (event) => {
        if (event.end) {
          streamListeners.delete(id);
          if (event.error === undefined) Queue.endUnsafe(queue);
          else Queue.failCauseUnsafe(queue, Cause.fail(safeDecode(decodeError, event.error)));
          return;
        }
        try {
          Queue.offerUnsafe(queue, decodeValue(event.value));
        } catch (error) {
          console.error(`kuru: ${tag} sent a value that did not decode`, error);
        }
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (streamListeners.delete(id)) rpcBridge().rpcUnsubscribe(id);
        }),
      );
      const answer = (yield* Effect.promise(() => rpcBridge().rpcSubscribe(id, tag, payload))) as LocalRpcAnswer;
      if (!answer.ok) {
        streamListeners.delete(id);
        return yield* new EnvironmentRpcUnavailableError({ environmentId: "local", message: String(answer.error) });
      }
    }),
  ) as Stream.Stream<EnvironmentRpcStreamValue<TTag>, EnvironmentRpcStreamFailure<TTag>>;
}

function safeDecode(decode: (value: unknown) => unknown, value: unknown): unknown {
  try {
    return decode(value);
  } catch {
    return new EnvironmentRpcUnavailableError({ environmentId: "local", message: String(value) });
  }
}

/** `subscribe`, scoped to an environment as T3 Code's are; kuru code has one. */
export function subscribeIn<TTag extends EnvironmentStreamRpcTag>(
  _environmentId: EnvironmentId,
  tag: TTag,
  input: EnvironmentRpcInput<TTag>,
) {
  return subscribe(tag, input);
}

/** T3 Code's command boundary; kuru code's one session may do everything. */
export class RpcPermissionGuard extends Context.Reference<{
  readonly authorize: (environmentId: EnvironmentId, method: string, input: unknown) => Effect.Effect<void, EnvironmentAuthorizationError>;
}>("@t3tools/client-runtime/rpc/RpcPermissionGuard", {
  defaultValue: () => ({ authorize: () => Effect.void }),
}) {}

export const requestGuarded = request;
export const runStreamGuarded = subscribe;

/** kuru code's main process answers branch streams itself (src/main/rpc.ts). */
export const subscribeVcsBranch = (input: EnvironmentRpcInput<typeof WS_METHODS.subscribeVcsBranch>) =>
  subscribe(WS_METHODS.subscribeVcsBranch, input);

export const refreshVcsBranch = (input: EnvironmentRpcInput<typeof WS_METHODS.vcsRefreshBranch>) =>
  request(WS_METHODS.vcsRefreshBranch, input);

export const runStream = subscribe;

/** `request`, scoped to an environment as T3 Code's are; kuru code has one. */
export function requestIn<TTag extends EnvironmentUnaryRpcTag>(
  _environmentId: EnvironmentId,
  tag: TTag,
  input: EnvironmentRpcInput<TTag>,
) {
  return request(tag, input);
}

export { ORCHESTRATION_V2_WS_METHODS, WS_METHODS };
