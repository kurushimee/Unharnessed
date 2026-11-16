// Builds kuru code: the main process and its preload with esbuild, the
// window with Vite. `--watch` rebuilds the main process on change.
import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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
  await build(options);
  if (!mainOnly) {
    const vite = spawnSync(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "build"], { cwd: root, stdio: "inherit" });
    if (vite.status !== 0) process.exit(vite.status ?? 1);
  }
}
