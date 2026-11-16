// A project's icon, found the way T3 Code's server finds one
// (apps/server/src/project/ProjectFaviconResolver.ts): well-known favicon
// files first, then the icon an index page or root route links. The window
// gets it as a data URL; lookups are cached, a miss for a minute.
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

const FAVICON_CANDIDATES = [
  "favicon.svg",
  "favicon.ico",
  "favicon.png",
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "app/favicon.ico",
  "app/favicon.png",
  "app/icon.svg",
  "app/icon.png",
  "app/icon.ico",
  "src/favicon.ico",
  "src/favicon.svg",
  "src/app/favicon.ico",
  "src/app/icon.svg",
  "src/app/icon.png",
  "assets/icon.svg",
  "assets/icon.png",
  "assets/logo.svg",
  "assets/logo.png",
  ".idea/icon.svg",
];

const ICON_SOURCE_FILES = [
  "index.html",
  "public/index.html",
  "app/routes/__root.tsx",
  "src/routes/__root.tsx",
  "app/root.tsx",
  "src/root.tsx",
  "src/index.html",
];

const LINK_ICON_HTML_RE =
  /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))[^>]*>/i;
const ICON_REL_RE = /\brel\s*:\s*["'](?:icon|shortcut icon)["']/i;
const ICON_HREF_RE = /\bhref\s*:\s*["']([^"'?]+)/i;

const MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const MAX_BYTES = 512 * 1024;
const HIT_TTL = 10 * 60_000;
const MISS_TTL = 60_000;

function extractIconHref(source: string): string | null {
  const htmlMatch = source.match(LINK_ICON_HTML_RE);
  if (htmlMatch?.[1]) return htmlMatch[1];
  for (const run of source.split("}")) {
    if (!ICON_REL_RE.test(run)) continue;
    const hrefMatch = run.match(ICON_HREF_RE);
    if (hrefMatch?.[1]) return hrefMatch[1];
  }
  return null;
}

function within(root: string, relativePath: string): string | null {
  const absolute = resolve(root, relativePath);
  const back = relative(root, absolute);
  return back.startsWith("..") || isAbsolute(back) ? null : absolute;
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then((found) => found.isFile(), () => false);
}

async function firstFile(root: string, candidates: readonly string[]): Promise<string | null> {
  // Probed together, taken in list order.
  const found = await Promise.all(
    candidates.map(async (candidate) => {
      const path = within(root, candidate);
      return path !== null && MIME[extname(path).toLowerCase()] && (await isFile(path)) ? path : null;
    }),
  );
  return found.find((path) => path !== null) ?? null;
}

async function findPath(root: string): Promise<string | null> {
  const wellKnown = await firstFile(root, FAVICON_CANDIDATES);
  if (wellKnown) return wellKnown;
  for (const sourceFile of ICON_SOURCE_FILES) {
    const sourcePath = within(root, sourceFile);
    if (sourcePath === null) continue;
    const source = await readFile(sourcePath, "utf8").catch(() => null);
    const href = source === null ? null : extractIconHref(source);
    if (!href) continue;
    const clean = href.replace(/^\//, "");
    const found = await firstFile(root, [join("public", clean), clean]);
    if (found) return found;
  }
  return null;
}

const cache = new Map<string, { url: string | null; at: number }>();

/** The image formats an icon can be, for the file picker. */
export const FAVICON_EXTENSIONS = Object.keys(MIME).map((extension) => extension.slice(1));

/**
 * The project's icon as a data URL, or `null` when it has none: the file chosen in its
 * settings (`chosen`, relative to the project or absolute), else the one found in it.
 */
export async function projectFavicon(root: string, chosen: string | null = null): Promise<string | null> {
  const key = `${root}\n${chosen ?? ""}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < (cached.url ? HIT_TTL : MISS_TTL)) return cached.url;
  let url: string | null = null;
  const path = chosen
    ? MIME[extname(chosen).toLowerCase()]
      ? resolve(root, chosen)
      : null
    : await findPath(root).catch(() => null);
  if (path) {
    const bytes = await readFile(path).catch(() => null);
    if (bytes && bytes.length <= MAX_BYTES) {
      url = `data:${MIME[extname(path).toLowerCase()]};base64,${bytes.toString("base64")}`;
    }
  }
  cache.set(key, { url, at: Date.now() });
  return url;
}
