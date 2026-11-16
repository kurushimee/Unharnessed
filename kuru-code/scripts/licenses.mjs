// The open-source license manifest Settings -> About -> Open source licenses reads
// (T3 Code's third-party-licenses.json, apps/web's OpenSourceLicenses.tsx): every package
// the built app carries, found from the modules the window's and the main process's
// bundles hold, with the notices of the projects kuru code is made from.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The folder of the package a bundled file belongs to: the last `node_modules/<name>`. */
function packageDir(file) {
  const parts = resolve(file).split(sep);
  const at = parts.lastIndexOf("node_modules");
  if (at < 0 || at + 1 >= parts.length) return null;
  const length = parts[at + 1].startsWith("@") ? 3 : 2;
  return parts.slice(0, at + length).join(sep);
}

const NOTICE = /^(licen[cs]e|copying|notice)(\.|-|$)/i;

function noticeText(dir) {
  const files = readdirSync(dir).filter((name) => NOTICE.test(name)).sort();
  return files.map((name) => readFileSync(join(dir, name), "utf8").trim()).join("\n\n");
}

function licenseOf(manifest) {
  if (typeof manifest.license === "string") return manifest.license;
  if (manifest.license && typeof manifest.license.type === "string") return manifest.license.type;
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((entry) => entry.type ?? entry).join(" OR ");
  return "UNKNOWN";
}

function sourceUrlOf(manifest) {
  const repository = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  const candidate = (repository ?? manifest.homepage ?? "")
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "")
    .replace(/^github:/, "https://github.com/");
  if (/^https?:\/\//.test(candidate)) return candidate;
  if (/^[\w.-]+\/[\w.-]+$/.test(candidate)) return `https://github.com/${candidate}`;
  return null;
}

/** The packages `files` come from, with the bundle each is in. */
function collect(files, bundle, into) {
  for (const file of files) {
    const dir = packageDir(file);
    if (!dir || !existsSync(join(dir, "package.json"))) continue;
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (!manifest.name) continue;
    const key = `${manifest.name}@${manifest.version ?? ""}`;
    const entry = into.get(key);
    if (entry) {
      if (!entry.bundles.includes(bundle)) entry.bundles.push(bundle);
      continue;
    }
    into.set(key, {
      bundles: [bundle],
      kind: "package",
      license: licenseOf(manifest),
      name: manifest.name,
      noticeText: noticeText(dir) || `${manifest.name} is distributed under the ${licenseOf(manifest)} license.`,
      sourceUrl: sourceUrlOf(manifest),
      version: manifest.version ?? null,
    });
  }
}

function custom(name, license, sourceUrl, file, bundles) {
  return {
    bundles,
    kind: "custom",
    license,
    name,
    noticeText: readFileSync(resolve(root, file), "utf8").trim(),
    sourceUrl,
    version: null,
  };
}

/**
 * Writes `out`: the packages of the window's modules (`windowFiles`) and of the main
 * process's (`mainFiles`), after the projects kuru code is made from.
 */
export function writeLicenseManifest({ windowFiles, mainFiles, out }) {
  const packages = new Map();
  collect(windowFiles, "window", packages);
  collect(mainFiles, "main", packages);
  const entries = [
    custom("T3 Code", "MIT", "https://github.com/pingdotgg/t3code", "LICENSE.t3code", ["window"]),
    custom("Unharnessed", "MIT", "https://github.com/kurushimee/Unharnessed", "../LICENSE", ["main", "agent"]),
    {
      ...custom("Electron", "MIT", "https://github.com/electron/electron", "node_modules/electron/LICENSE", ["main"]),
      version: JSON.parse(readFileSync(resolve(root, "node_modules/electron/package.json"), "utf8")).version,
      noticeText: `${readFileSync(resolve(root, "node_modules/electron/LICENSE"), "utf8").trim()}\n\nChromium's notices ship beside the app, in LICENSES.chromium.html.`,
    },
    ...(windowFiles.some((file) => /components[\\/]files[\\/]office[\\/]/.test(file))
      ? [
          custom(
            "opencode Office viewers",
            "MIT",
            "https://github.com/anomalyco/opencode",
            "src/renderer/components/files/office/LICENSE.opencode",
            ["window"],
          ),
        ]
      : []),
    ...[...packages.values()].sort((left, right) => left.name.localeCompare(right.name)),
  ];
  writeFileSync(out, JSON.stringify({ schemaVersion: 1, entries }));
  return entries.length;
}
