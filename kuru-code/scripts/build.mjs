// Builds kuru code: the main process and its preload with esbuild, the
// window with Vite. `--watch` rebuilds the main process on change.
import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { writeLicenseManifest } from "./licenses.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");
const mainOnly = process.argv.includes("--main");

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: ["electron"],
  outExtension: { ".js": ".cjs" },
  logLevel: "info",
  alias: {
    vscode: resolve(root, "src/main/vscode-runtime.ts"),
    "@shared": resolve(root, "src/shared"),
    "~": resolve(root, "src/renderer"),
  },
  // The extension's modules (../vscode/src) take their packages from here.
  nodePaths: [resolve(root, "node_modules")],
};

const options = {
  ...common,
  entryPoints: { main: resolve(root, "src/main/main.ts"), preload: resolve(root, "src/main/preload.ts") },
  outdir: resolve(root, "dist/main"),
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  const main = await build({ ...options, metafile: true });
  if (!mainOnly) {
    const vite = spawnSync(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "build"], { cwd: root, stdio: "inherit" });
    if (vite.status !== 0) process.exit(vite.status ?? 1);
    // Settings -> About -> Open source licenses: the packages both bundles carry.
    const listed = resolve(root, "dist/renderer/bundled-modules.json");
    const count = writeLicenseManifest({
      windowFiles: JSON.parse(readFileSync(listed, "utf8")),
      mainFiles: Object.keys(main.metafile.inputs).map((input) => resolve(root, input)),
      out: resolve(root, "dist/renderer/third-party-licenses.json"),
    });
    rmSync(listed);
    console.log(`third-party-licenses.json: ${count} entries`);
  }
}
