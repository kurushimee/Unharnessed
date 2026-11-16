import { execFile } from "node:child_process";
import type { LogOutputChannel } from "vscode";
import type { PullRequestSummary } from "@shared/git";

type Run = { code: number; stdout: string; stderr: string };

/** A program in `cwd`, its output whole; never throws. */
export function run(program: string, args: string[], cwd: string, input?: string, timeout = 120_000): Promise<Run> {
  return new Promise((done) => {
    const child = execFile(
      program,
      args,
      { cwd, maxBuffer: 512 * 1024 * 1024, windowsHide: true, timeout, env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" } },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1) : 0;
        done({ code, stdout: String(stdout), stderr: String(stderr) || (error && !stderr ? error.message : "") });
      },
    );
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

const git = (cwd: string, ...args: string[]) => run("git", args, cwd);
const gh = (cwd: string, ...args: string[]) => run("gh", args, cwd);

/**
 * What a thread shows of its folder's git and GitHub: its branch, and that branch's pull
 * request. Git through `git`, GitHub through `gh`, both in the project's folder. The Pull
 * requests page reads GitHub through T3 Code's service instead (pullRequests.ts).
 */
export class Git {
  /** `owner/name` by folder. */
  private repos = new Map<string, Promise<string | null>>();

  constructor(private readonly log: LogOutputChannel) {}

  async branch(cwd: string): Promise<string | undefined> {
    const { code, stdout } = await git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
    const name = stdout.trim();
    return code === 0 && name && name !== "HEAD" ? name : undefined;
  }

  /** The GitHub repository the folder's origin points to. */
  github(cwd: string): Promise<string | null> {
    let repo = this.repos.get(cwd);
    if (!repo) {
      repo = git(cwd, "remote", "get-url", "origin").then(({ code, stdout }) => (code === 0 ? githubRepo(stdout.trim()) : null));
      this.repos.set(cwd, repo);
      void repo.then((found) => found === null && this.repos.delete(cwd));
    }
    return repo;
  }

  /** The pull request of `branch`: the open one, else the latest. */
  async pullRequestFor(cwd: string, branch: string): Promise<PullRequestSummary | null> {
    const { code, stdout, stderr } = await gh(
      cwd,
      "pr", "list", "--head", branch, "--state", "all", "--limit", "5",
      "--json", "number,title,url,state,isDraft,mergeable,baseRefName,headRefName",
    );
    if (code !== 0) {
      this.log.warn(`git: no pull request lookup for ${branch} in ${cwd}: ${stderr.trim()}`);
      return null;
    }
    const rows = parseJson<{ number: number; title: string; url: string; state: string; isDraft: boolean; mergeable: string; baseRefName: string; headRefName: string }[]>(stdout) ?? [];
    const row = rows.find((pr) => pr.state === "OPEN") ?? rows[0];
    if (!row) return null;
    return {
      number: row.number,
      title: row.title,
      url: row.url,
      state: prState(row.state),
      draft: row.isDraft,
      mergeable: row.mergeable as PullRequestSummary["mergeable"],
      baseRefName: row.baseRefName,
      headRefName: row.headRefName,
    };
  }

}

function prState(state: string): "open" | "closed" | "merged" {
  const upper = state.toUpperCase();
  return upper === "MERGED" ? "merged" : upper === "CLOSED" ? "closed" : "open";
}

/** `owner/name` of a GitHub remote URL, in any of its forms. */
export function githubRepo(url: string): string | null {
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
  return match ? `${match[1]}/${match[2]}` : null;
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
