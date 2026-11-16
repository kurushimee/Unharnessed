// Development: Vite serves the window with hot reload, esbuild rebuilds the
// main process; Electron starts once both are up (restart it for main changes).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

spawn(process.execPath, [resolve(root, "scripts/build.mjs"), "--watch"], { cwd: root, stdio: "inherit", env });
const vite = spawn(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js")], { cwd: root, stdio: "inherit", env });
setTimeout(() => {
  const app = spawn(electron, [root], { stdio: "inherit", env: { ...env, KURU_DEV_URL: "http://localhost:5791" } });
  app.on("exit", () => {
    vite.kill();
    process.exit(0);
  });
}, 3000);
