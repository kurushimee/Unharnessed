// T3 Code's client-runtime state/assets.ts; its URLs come from kuru code's main process.
import {
  type AssetCreateUrlInput,
  type AssetCreateUrlResult,
  type AssetImageDimensions,
  AssetResource,
  EnvironmentId,
  type ProjectCloneSnapshot,
  WS_METHODS,
} from "~/contracts";
import { mediaMimeTypeFromExtension } from "~/shared/mediaPreview";
import { isWindowsAbsolutePath } from "~/shared/path";
import {
  getProjectFaviconResourceKey,
  isProjectFaviconFallbackUrl,
} from "~/shared/projectFavicon";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import type { ProjectFaviconCache, ProjectFaviconTarget } from "../projectFaviconCache";
import { createLocalRpcQueryAtomFamily } from "./runtime";

const ASSET_URL_REFRESH_INTERVAL_MS = 30 * 60_000;
const ASSET_URL_STALE_TIME_MS = 5 * 60_000;
const ASSET_URL_IDLE_TTL_MS = 60 * 60_000;
export const ASSET_URL_MAX_IN_FLIGHT = 6;

export class InvalidAssetCollectionKeyError extends Schema.TaggedError<InvalidAssetCollectionKeyError>()(
  "InvalidAssetCollectionKeyError",
  {
    key: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Invalid asset collection atom key: ${JSON.stringify(this.key)}.`;
  }
}

const decodeAssetCollectionKey = Schema.decodeUnknownSync(
  Schema.Tuple([EnvironmentId, Schema.Array(AssetResource)]),
);

function parseAssetCollectionKey(
  key: string,
): readonly [EnvironmentId, ReadonlyArray<AssetResource>] {
  try {
    return decodeAssetCollectionKey(JSON.parse(key));
  } catch (cause) {
    throw new InvalidAssetCollectionKeyError({ key, cause });
  }
}

export function resolveAssetUrl(httpBaseUrl: string, relativeUrl: string): string | null {
  try {
    return new URL(relativeUrl, httpBaseUrl).toString();
  } catch {
    return null;
  }
}

export const EMPTY_ASSET_URL_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("asset-url:empty"),
);

export type AssetUrlState =
  | { readonly _tag: "Loading" }
  | {
      readonly _tag: "Failure";
      readonly reason?: "missing-file-access";
    }
  | {
      readonly _tag: "Success";
      readonly url: string;
      readonly expiresAt: number;
      readonly sourcePath?: string;
      readonly imageDimensions?: AssetImageDimensions;
      readonly fileRevision?: string;
    };

export const MISSING_FILE_ACCESS_MESSAGE =
  "This connection cannot read host files. Pair again with a new link to view it.";

export function blockedAssetUrlState(
  resource: AssetResource | null,
  fileAccess: {
    readonly canReadFiles: boolean;
    readonly isPending: boolean;
    readonly error: string | null;
  },
): AssetUrlState | null {
  if (
    resource === null ||
    fileAccess.canReadFiles ||
    (resource._tag !== "workspace-file" &&
      resource._tag !== "media-file" &&
      resource._tag !== "draft-workspace-file" &&
      !(resource._tag === "native-app-icon" && resource.app._tag === "app-path"))
  ) {
    return null;
  }
  if (fileAccess.isPending) return { _tag: "Loading" };
  return fileAccess.error === null
    ? { _tag: "Failure", reason: "missing-file-access" }
    : { _tag: "Failure" };
}

export function assetUrlStateFromResult(
  result: AsyncResult.AsyncResult<AssetCreateUrlResult, unknown>,
  httpBaseUrl: string | null,
): AssetUrlState {
  if (result._tag === "Failure") return { _tag: "Failure" };
  if (httpBaseUrl === null || result._tag !== "Success") return { _tag: "Loading" };
  const url = resolveAssetUrl(httpBaseUrl, result.value.relativeUrl);
  if (url === null) return { _tag: "Failure" };
  return {
    _tag: "Success",
    url,
    expiresAt: result.value.expiresAt,
    ...(result.value.sourcePath !== undefined ? { sourcePath: result.value.sourcePath } : {}),
    ...(result.value.imageDimensions !== undefined
      ? { imageDimensions: result.value.imageDimensions }
      : {}),
    ...(result.value.fileRevision !== undefined ? { fileRevision: result.value.fileRevision } : {}),
  };
}

type AssetUrlTarget = {
  readonly environmentId: EnvironmentId;
  readonly input: { readonly resource: AssetResource };
};

const decodeRevisionedAssetUrlKey = Schema.decodeUnknownSync(
  Schema.Tuple([EnvironmentId, AssetResource, Schema.NullOr(Schema.String)]),
);

const isSettled = (result: AsyncResult.AsyncResult<unknown, unknown>) =>
  !AsyncResult.isInitial(result) && !result.waiting;

const KEEP_URL_MIN_LIFE_MS = 5 * 60_000;

/**
 * A re-mint signs a new URL even when the file is unchanged, and a new URL reloads the image.
 * Keep the shown URL while the server reports the same file revision and it has time left.
 */
function keepUnchangedFile(
  shown: AsyncResult.AsyncResult<AssetCreateUrlResult, unknown>,
  next: AsyncResult.AsyncResult<AssetCreateUrlResult, unknown>,
  now: number,
) {
  if (
    shown._tag !== "Success" ||
    next._tag !== "Success" ||
    next.value.fileRevision === undefined ||
    next.value.fileRevision !== shown.value.fileRevision ||
    shown.value.expiresAt - now <= KEEP_URL_MIN_LIFE_MS
  ) {
    return next;
  }
  const kept = AsyncResult.success(shown.value);
  return next.waiting ? AsyncResult.waiting(kept) : kept;
}

/**
 * The URL is minted per resource and shared across revisions, so reading a
 * different revision (even an earlier one after a revert) re-mints it. An
 * in-flight mint is shared only on first read; after an edit the server must
 * re-read the file, so the re-mint waits for that mint to settle.
 */
export function makeRevisionedAssetUrlFamily(
  createUrl: (
    target: AssetUrlTarget,
  ) => Atom.Atom<AsyncResult.AsyncResult<AssetCreateUrlResult, unknown>>,
  now: () => number = Date.now,
) {
  // Outside the nodes: a node is dropped once unmounted, and the next read of
  // its revision must still see the revisions minted since. Never pruned on
  // purpose: pruning would forget the revision and re-mint on the next mount.
  // It holds one short entry per file shown, and goes with the registry.
  const mintedUnder = new WeakMap<AtomRegistry.AtomRegistry, Map<string, string | null>>();
  // Also per resource: a new revision builds a new node, which must keep the URL on screen.
  const shownUnder = new WeakMap<
    AtomRegistry.AtomRegistry,
    Map<string, AsyncResult.AsyncResult<AssetCreateUrlResult, unknown>>
  >();
  const family = Atom.family((key: string) => {
    const [environmentId, resource, revision] = decodeRevisionedAssetUrlKey(JSON.parse(key));
    const resourceKey = JSON.stringify([environmentId, resource]);
    const query = createUrl({ environmentId, input: { resource } });
    return Atom.transform(
      query,
      (get) => {
        let minted = mintedUnder.get(get.registry);
        if (minted === undefined) {
          minted = new Map();
          mintedUnder.set(get.registry, minted);
        }
        const firstRead = !minted.has(resourceKey);
        let pending = minted.get(resourceKey) !== revision;
        const current = get.once(query);
        if (pending && (firstRead || isSettled(current))) {
          pending = false;
          minted.set(resourceKey, revision);
          if (isSettled(current)) get.refresh(query);
        }
        let shownByResource = shownUnder.get(get.registry);
        if (shownByResource === undefined) {
          shownByResource = new Map();
          shownUnder.set(get.registry, shownByResource);
        }
        const show = (value: AsyncResult.AsyncResult<AssetCreateUrlResult, unknown>) => {
          const previous = shownByResource.get(resourceKey);
          const shown = previous === undefined ? value : keepUnchangedFile(previous, value, now());
          shownByResource.set(resourceKey, shown);
          return shown;
        };
        get.subscribe(query, (value) => {
          get.setSelf(show(value));
          if (!pending || !isSettled(value)) return;
          pending = false;
          minted.set(resourceKey, revision);
          get.refresh(query);
        });
        return show(get.once(query));
      },
      { initialValueTarget: query },
      // No idle TTL: each mount rebuilds the node, so a revision read again after
      // another one is compared against the record instead of a cached node.
    ).pipe(Atom.setIdleTTL(0));
  });
  return (target: AssetUrlTarget & { readonly revision: string | null }) =>
    family(JSON.stringify([target.environmentId, target.input.resource, target.revision]));
}

/**
 * T3 Code's asset URLs: its server signs a URL for each file a thread shows.
 * kuru code's main process answers the same RPC with a kuru-asset: URL it
 * serves itself (src/main/assets.ts).
 */
export function createAssetEnvironmentAtoms() {
  const createUrl = createLocalRpcQueryAtomFamily({
    label: "environment-data:assets:create-url",
    tag: WS_METHODS.assetsCreateUrl,
    staleTimeMs: ASSET_URL_STALE_TIME_MS,
    idleTtlMs: ASSET_URL_IDLE_TTL_MS,
  });
  const createUrlsFamily = Atom.family((key: string) => {
    const [environmentId, resources] = parseAssetCollectionKey(key);
    return Atom.make((get) =>
      resources.map((resource) =>
        get(
          createUrl({
            environmentId,
            input: { resource },
          }),
        ),
      ),
    ).pipe(
      Atom.setIdleTTL(ASSET_URL_IDLE_TTL_MS),
      Atom.withLabel(`environment-data:assets:create-urls:${key}`),
    );
  });

  return {
    createUrl,
    createUrls: (target: {
      readonly environmentId: EnvironmentId;
      readonly resources: ReadonlyArray<AssetResource>;
    }) => createUrlsFamily(JSON.stringify([target.environmentId, target.resources])),
  };
}

export function createProjectFaviconUrlAtomFamily(input: {
  readonly imageCache?: ProjectFaviconCache;
  readonly createUrl: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly resource: AssetResource };
  }) => Atom.Atom<AsyncResult.AsyncResult<AssetCreateUrlResult, unknown>>;
  readonly preparedConnection: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<Option.Option<{ readonly httpBaseUrl: string }>>;
  readonly projectClones?: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<ReadonlyArray<ProjectCloneSnapshot>>;
}) {
  const decodeKey = Schema.decodeUnknownSync(
    Schema.Tuple([EnvironmentId, Schema.String, Schema.NullOr(Schema.String)]),
  );
  const projectClones = input.projectClones;
  const family = Atom.family((key: string) => {
    const [environmentId, cwd, path] = decodeKey(JSON.parse(key));
    const resource = { _tag: "project-favicon" as const, cwd, ...(path ? { path } : {}) };
    const query = input.createUrl({ environmentId, input: { resource } });
    // A cloned project exists before its files do, and the server reports its
    // icon missing until the clone lands. Ask again whenever the clone's phase
    // changes: the first list a client sees may already say done.
    const request = projectClones
      ? query.pipe(
          Atom.makeRefreshOnSignal(
            Atom.make(
              (get) =>
                get(projectClones(environmentId)).find((clone) => clone.destinationPath === cwd)
                  ?.phase ?? null,
            ),
          ),
        )
      : query;
    const resolvedUrl = Atom.make((get): string | null => {
      const result = get(request);
      const connection = get(input.preparedConnection(environmentId));
      const state = assetUrlStateFromResult(
        result,
        Option.isSome(connection) ? connection.value.httpBaseUrl : null,
      );
      return state._tag === "Success" ? state.url : Option.getOrNull(get.self<string | null>());
    }).pipe(Atom.setIdleTTL(ASSET_URL_IDLE_TTL_MS));
    const cache = input.imageCache;
    if (!cache) return resolvedUrl;

    const target = { environmentId, cwd, faviconPath: path };
    const image = Atom.make((get) => {
      get(request);
      const url = get(resolvedUrl);
      return Effect.promise((signal) => cache.resolve(target, url, signal));
    }).pipe(Atom.setIdleTTL(ASSET_URL_IDLE_TTL_MS));

    return Atom.make((get): string | null => {
      const result = get(image);
      if (isProjectFaviconFallbackUrl(get(resolvedUrl))) return null;
      return AsyncResult.getOrElse(result, () => cache.peek(target));
    }).pipe(Atom.setIdleTTL(ASSET_URL_IDLE_TTL_MS));
  });
  return (target: ProjectFaviconTarget) =>
    family(getProjectFaviconResourceKey(target.environmentId, target.cwd, target.faviconPath));
}
