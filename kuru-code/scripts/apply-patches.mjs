// T3 Code patches some of its dependencies (its pnpm patches, in ../patches);
// kuru code renders with the same ones, so it applies them after install.
// A patch already applied is left alone.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dir = join(root, "patches");

for (const file of readdirSync(dir).filter((name) => name.endsWith(".patch"))) {
  // "@scope__name@1.2.3.patch" patches node_modules/@scope/name at that version.
  const spec = file.slice(0, -".patch".length).replace("__", "/");
  const at = spec.lastIndexOf("@");
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  const pkg = join(root, "node_modules", name);
  const manifest = join(pkg, "package.json");
  if (!existsSync(manifest)) continue;
  const installed = JSON.parse(readFileSync(manifest, "utf8")).version;
  if (installed !== version) {
    console.warn(`patches: ${name} is ${installed}, its patch is for ${version}; skipped`);
    continue;
  }
  const patch = join(dir, file);
  // Outside any repository: inside kuru code's, git apply skips paths in node_modules.
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(pkg) };
  const git = (...args) => execFileSync("git", ["apply", ...args, patch], { cwd: pkg, env, stdio: "pipe" });
  try {
    git("--reverse", "--check");
    continue; // applied already
  } catch {}
  git();
  console.log(`patches: ${name}@${version}`);
}
