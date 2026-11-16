import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LogOutputChannel } from "vscode";
import { run } from "./git";
import { agentDir } from "./sessions";

/** The staged diff a message is written from, at most. */
const DIFF_CHARS = 60_000;

/**
 * A commit message for the staged changes, written by the agent's summary
 * model (`auxiliaryModel`) in a one-shot `unharnessed -p` without tools,
 * session or skills; the first line of the change list when it cannot.
 */
export async function writeCommitMessage(binary: string, cwd: string, log: LogOutputChannel): Promise<string> {
  const [stat, diff] = await Promise.all([
    run("git", ["diff", "--cached", "--stat"], cwd),
    run("git", ["diff", "--cached"], cwd),
  ]);
  const fallback = fallbackMessage(stat.stdout);
  let model: string | undefined;
  try {
    const settings = JSON.parse(await readFile(join(agentDir(), "settings.json"), "utf8")) as { auxiliaryModel?: string };
    model = settings.auxiliaryModel;
  } catch {
    // The default model.
  }
  const prompt = [
    "Write a git commit message for these staged changes.",
    "Answer with the message only: a subject line under 72 characters in the imperative mood, then, only if useful, a blank line and a short body.",
    "",
    stat.stdout.trim(),
    "",
    diff.stdout.slice(0, DIFF_CHARS),
  ].join("\n");
  const args = ["-p", "--no-session", "--no-tools", "--no-skills", "--no-context-files", "--no-prompt-templates"];
  if (model) args.push("--model", model);
  args.push(prompt);
  const started = Date.now();
  const answer = await run(binary, args, cwd, undefined, 120_000);
  const text = answer.stdout.trim().replace(/^```\w*\n?|```$/g, "").trim();
  if (answer.code !== 0 || !text) {
    log.warn(`writer: no commit message (${answer.code}): ${answer.stderr.trim().slice(0, 300)}`);
    return fallback;
  }
  log.info(`writer: commit message written in ${Date.now() - started} ms`);
  return text;
}

function fallbackMessage(stat: string): string {
  const files = stat
    .split("\n")
    .map((line) => line.split("|")[0]?.trim())
    .filter((name): name is string => Boolean(name) && !/files? changed/.test(name));
  if (files.length === 0) return "Update files";
  if (files.length === 1) return `Update ${files[0]}`;
  return `Update ${files.length} files`;
}
