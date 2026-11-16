// Packages kuru code for Windows: the agent built from this repository and
// what it looks for beside it (the kernel's Python package, the built-in
// skills: the files git tracks, as the VS Code extension ships them), then
// a per-user installer with electron-builder (release/).
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "..");
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (!process.argv.includes("--no-cargo")) run("cargo", ["build", "--release", "--locked", "-p", "uh-cli", "--bin", "unharnessed"], repo);
const exe = process.platform === "win32" ? "unharnessed.exe" : "unharnessed";
const built = join(repo, "target", "release", exe);
if (!existsSync(built)) {
  console.error(`no agent at ${built}`);
  process.exit(1);
}

const bin = join(root, "build", "bin");
rmSync(bin, { recursive: true, force: true });
mkdirSync(bin, { recursive: true });
cpSync(built, join(bin, exe));
const tracked = execFileSync("git", ["ls-files", "-z", "--", "unharnessed-runtime/pyproject.toml", "unharnessed-runtime/src", "skills"], { cwd: repo, encoding: "utf8" });
for (const file of tracked.split("\0").filter(Boolean)) {
  mkdirSync(dirname(join(bin, file)), { recursive: true });
  cpSync(join(repo, file), join(bin, file));
}

run(process.execPath, [join(root, "node_modules", "electron-builder", "cli.js"), "--win", "--x64", "--publish", "never"], root);
