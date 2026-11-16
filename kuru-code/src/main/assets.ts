// T3 Code's asset URLs: its server signs a URL for each local file a thread
// shows (an image the agent's reply points at, a file a link names). kuru
// code's main process answers assets.createUrl with a kuru-asset: URL of a
// token it minted for that file, and serves the file under it.
import { createHash, randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import type { AppState } from "@shared/protocol";

const SCHEME = "kuru-asset";
/** How long a minted URL serves its file, as T3 Code's signed URLs expire. */
const TTL_MS = 60 * 60_000;

/** Before the app is ready: the scheme fetches and streams like https. */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

type Resource =
  | { _tag: "workspace-file"; threadId: string; path: string }
  | { _tag: "media-file"; threadId: string; path: string; disposition?: "attachment" }
  | { _tag: "draft-workspace-file"; cwd: string; path: string }
  | { _tag: string };

/** T3 Code's AssetAccessError, encoded: one of its tagged errors, about the resource asked for. */
export class AssetFailure extends Error {
  constructor(readonly encoded: { readonly _tag: string; readonly resource: Resource } & Record<string, unknown>) {
    super(encoded._tag);
  }
}

function refuse(_tag: string, resource: Resource, fields: Record<string, unknown> = {}): never {
  throw new AssetFailure({ _tag, resource, ...fields });
}

export function createAssets(app: () => AppState | null) {
  const tokens = new Map<string, { path: string; expiresAt: number; download: boolean }>();

  /** The folder a thread works in: its row's, or the shown thread's while it has no row yet. */
  const threadCwd = (resource: Resource, threadId: string): string => {
    const state = app();
    const row = state?.threads.find((thread) => thread.id === threadId);
    if (row) return row.cwd;
    if (state?.shown.id === threadId) return state.shown.cwd;
    return refuse("AssetWorkspaceContextNotFoundError", resource);
  };

  /** A path under a folder; one leading out of it is refused. */
  const inside = (resource: Resource, root: string, path: string): string => {
    const target = resolve(root, path);
    const rel = relative(resolve(root), target);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      refuse("AssetWorkspacePathValidationError", resource, { cause: `${path} leads out of ${root}.` });
    }
    return target;
  };

  const pathOf = (resource: Resource): { path: string; download: boolean } => {
    switch (resource._tag) {
      case "workspace-file": {
        const { threadId, path } = resource as Extract<Resource, { _tag: "workspace-file" }>;
        return { path: inside(resource, threadCwd(resource, threadId), path), download: false };
      }
      case "media-file": {
        const { threadId, path, disposition } = resource as Extract<Resource, { _tag: "media-file" }>;
        // Media a reply shows may live anywhere on this computer, as T3 Code's media files may.
        return {
          path: isAbsolute(path) ? path : resolve(threadCwd(resource, threadId), path),
          download: disposition === "attachment",
        };
      }
      case "draft-workspace-file": {
        const { cwd, path } = resource as Extract<Resource, { _tag: "draft-workspace-file" }>;
        return { path: inside(resource, cwd, path), download: false };
      }
      // A prompt's images reach the window with the prompt; nothing else is kept to serve.
      default:
        return refuse(resource._tag === "attachment" ? "AssetAttachmentNotFoundError" : "AssetWorkspaceContextNotFoundError", resource);
    }
  };

  return {
    serve(): void {
      protocol.handle(SCHEME, (request) => {
        const token = new URL(request.url).hostname;
        const minted = tokens.get(token);
        if (!minted || minted.expiresAt < Date.now()) return new Response("Gone", { status: 410 });
        // The window's file:// origin reads it with fetch() too (copying an image), so it allows any origin.
        return net.fetch(pathToFileURL(minted.path).href).then((response) => {
          const headers = new Headers(response.headers);
          headers.set("Access-Control-Allow-Origin", "*");
          if (minted.download) headers.set("Content-Disposition", "attachment");
          return new Response(response.body, { status: response.status, headers });
        });
      });
    },

    async createUrl(input: { resource: Resource }) {
      const { path, download } = pathOf(input.resource);
      let info;
      try {
        info = await stat(path);
      } catch {
        return refuse("AssetWorkspaceAssetNotFoundError", input.resource, { checkedPath: path });
      }
      if (!info.isFile()) refuse("AssetWorkspaceAssetNotFoundError", input.resource, { checkedPath: path });
      for (const [token, minted] of tokens) if (minted.expiresAt < Date.now()) tokens.delete(token);
      const token = randomUUID();
      const expiresAt = Date.now() + TTL_MS;
      tokens.set(token, { path, expiresAt, download });
      const name = encodeURIComponent(path.split(/[\\/]/).pop() ?? "file");
      return {
        relativeUrl: `${SCHEME}://${token}/${name}`,
        expiresAt,
        sourcePath: path,
        fileRevision: createHash("sha1").update(`${path}:${info.size}:${info.mtimeMs}`).digest("hex"),
      };
    },
  };
}
