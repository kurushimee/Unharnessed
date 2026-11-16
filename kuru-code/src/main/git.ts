import { execFile } from "node:child_process";
import type { LogOutputChannel } from "vscode";
import type {
  Branch,
  ChangedFile,
  GitActionRequest,
  GitActionResult,
  GitStatus,
  PullRequestDetail,
  PullRequestListItem,
  PullRequestSummary,
} from "@shared/git";

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
 * The git and GitHub side of a project: what the thread details show, the
 * actions it runs (commit, push, pull request), and the Pull requests page.
 * Git through `git`, GitHub through `gh`, both in the project's folder.
 */
export class Git {
  /** `owner/name` by folder. */
  private repos = new Map<string, Promise<string | null>>();
  private viewer: Promise<string | null> | undefined;

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

  async status(cwd: string): Promise<GitStatus> {
    const inside = await git(cwd, "rev-parse", "--is-inside-work-tree");
    if (inside.code !== 0 || inside.stdout.trim() !== "true") return { repo: false };
    const [porcelain, remotes, github, defaultRef] = await Promise.all([
      git(cwd, "status", "--porcelain=v2", "--branch", "--untracked-files=all"),
      git(cwd, "remote"),
      this.github(cwd),
      git(cwd, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"),
    ]);
    let branch: string | null = null;
    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;
    let changedFiles = 0;
    for (const line of porcelain.stdout.split("\n")) {
      if (line.startsWith("# branch.head ")) {
        const head = line.slice(14).trim();
        branch = head === "(detached)" ? null : head;
      } else if (line.startsWith("# branch.upstream ")) {
        upstream = line.slice(18).trim();
      } else if (line.startsWith("# branch.ab ")) {
        const match = /\+(\d+) -(\d+)/.exec(line);
        if (match) {
          ahead = Number(match[1]);
          behind = Number(match[2]);
        }
      } else if (line && !line.startsWith("#")) {
        changedFiles++;
      }
    }
    const hasRemote = remotes.stdout.trim().length > 0;
    let defaultBranch = defaultRef.code === 0 ? defaultRef.stdout.trim().replace(/^origin\//, "") : null;
    if (!defaultBranch && hasRemote) {
      for (const candidate of ["main", "master"]) {
        if ((await git(cwd, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${candidate}`)).code === 0) {
          defaultBranch = candidate;
          break;
        }
      }
    }
    if (!defaultBranch) {
      for (const candidate of ["main", "master"]) {
        if ((await git(cwd, "rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`)).code === 0) {
          defaultBranch = candidate;
          break;
        }
      }
    }
    let aheadOfDefault = 0;
    let diff: { added: number; removed: number; against: string } | null = null;
    if (defaultBranch) {
      const base = (await git(cwd, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${defaultBranch}`)).code === 0
        ? `origin/${defaultBranch}`
        : defaultBranch;
      const [count, mergeBase] = await Promise.all([
        git(cwd, "rev-list", "--count", `${base}..HEAD`),
        git(cwd, "merge-base", base, "HEAD"),
      ]);
      aheadOfDefault = Number(count.stdout.trim()) || 0;
      if (mergeBase.code === 0) {
        const numstat = await git(cwd, "diff", "--numstat", mergeBase.stdout.trim());
        diff = { ...sumNumstat(numstat.stdout), against: base };
      }
    }
    const pr = branch && github && branch !== defaultBranch ? await this.pullRequestFor(cwd, branch) : null;
    return { repo: true, branch, upstream, ahead, behind, changedFiles, defaultBranch, aheadOfDefault, diff, github, hasRemote, pr };
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

  async branches(cwd: string): Promise<Branch[]> {
    const { stdout } = await git(
      cwd,
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname)%09%(HEAD)%09%(committerdate:unix)",
      "refs/heads",
      "refs/remotes",
    );
    const branches: Branch[] = [];
    for (const line of stdout.split("\n")) {
      const [ref, head, date] = line.split("\t");
      if (!ref || ref.endsWith("/HEAD")) continue;
      const remote = ref.startsWith("refs/remotes/");
      const name = ref.replace(/^refs\/(heads|remotes)\//, "");
      branches.push({ name, remote, current: head === "*", updated: Number(date) * 1000 || 0 });
    }
    return branches;
  }

  async checkout(cwd: string, branch: string, create = false): Promise<string | undefined> {
    const args = create ? ["switch", "-c", branch] : branch.includes("/") && !(await this.hasLocal(cwd, branch)) ? ["switch", "--track", branch] : ["switch", branch];
    const result = await git(cwd, ...args);
    this.log.info(`git: ${args.join(" ")} in ${cwd}: ${result.code === 0 ? "done" : result.stderr.trim()}`);
    return result.code === 0 ? undefined : result.stderr.trim() || "git switch failed";
  }

  private async hasLocal(cwd: string, branch: string): Promise<boolean> {
    return (await git(cwd, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`)).code === 0;
  }

  async init(cwd: string): Promise<string | undefined> {
    const result = await git(cwd, "init");
    return result.code === 0 ? undefined : result.stderr.trim();
  }

  async changedFiles(cwd: string, against?: string): Promise<ChangedFile[]> {
    const base = against ? (await git(cwd, "merge-base", against, "HEAD")).stdout.trim() : "HEAD";
    const [numstat, names, untracked] = await Promise.all([
      git(cwd, "diff", "--numstat", base || "HEAD"),
      git(cwd, "diff", "--name-status", base || "HEAD"),
      git(cwd, "ls-files", "--others", "--exclude-standard"),
    ]);
    const status = new Map<string, string>();
    for (const line of names.stdout.split("\n")) {
      const [code, ...paths] = line.split("\t");
      if (code && paths.length) status.set(paths.at(-1)!, code[0]);
    }
    const files: ChangedFile[] = [];
    for (const line of numstat.stdout.split("\n")) {
      const [added, removed, ...rest] = line.split("\t");
      if (!rest.length) continue;
      const path = rest.join("\t").replace(/^.*=> /, "").replace(/[{}]/g, "");
      files.push({ path, added: Number(added) || 0, removed: Number(removed) || 0, status: status.get(path) ?? "M" });
    }
    for (const path of untracked.stdout.split("\n").filter(Boolean)) {
      files.push({ path, added: 0, removed: 0, status: "?" });
    }
    return files;
  }

  async diff(cwd: string, against?: string, path?: string): Promise<string> {
    const base = against ? (await git(cwd, "merge-base", against, "HEAD")).stdout.trim() || "HEAD" : "HEAD";
    const { stdout } = await git(cwd, "diff", base, ...(path ? ["--", path] : []));
    return stdout;
  }

  /** Commit, push, open a pull request: each step only if the one before went. */
  async act(request: GitActionRequest, writeMessage: (cwd: string) => Promise<string>): Promise<GitActionResult> {
    const { cwd, action } = request;
    const steps: string[] = [];
    try {
      if (request.newBranch) {
        const error = await this.checkout(cwd, request.newBranch, true);
        if (error) return { ok: false, error };
        steps.push(`branch ${request.newBranch}`);
      }
      if (action === "pull") {
        const result = await git(cwd, "pull", "--ff-only");
        if (result.code !== 0) return { ok: false, error: result.stderr.trim() || "git pull failed" };
        return { ok: true, summary: "Pulled the latest changes." };
      }
      if (action === "commit" || action === "commit_push" || action === "commit_push_pr") {
        const add = await git(cwd, "add", "-A");
        if (add.code !== 0) return { ok: false, error: add.stderr.trim() };
        const message = request.message?.trim() || (await writeMessage(cwd));
        const commit = await run("git", ["commit", "-F", "-"], cwd, message);
        if (commit.code !== 0) return { ok: false, error: (commit.stderr || commit.stdout).trim() || "git commit failed" };
        steps.push(`committed "${message.split("\n", 1)[0]}"`);
      }
      if (action === "push" || action === "commit_push" || action === "commit_push_pr" || action === "create_pr") {
        const upstream = await git(cwd, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
        const push = upstream.code === 0 ? await git(cwd, "push") : await git(cwd, "push", "-u", "origin", "HEAD");
        if (push.code !== 0) return { ok: false, error: push.stderr.trim() || "git push failed" };
        steps.push("pushed");
      }
      let prUrl: string | undefined;
      if (action === "commit_push_pr" || action === "create_pr") {
        const args = ["pr", "create"];
        if (request.prTitle?.trim()) args.push("--title", request.prTitle.trim(), "--body", request.prBody ?? "");
        else args.push("--fill");
        if (request.draft) args.push("--draft");
        const created = await gh(cwd, ...args);
        if (created.code !== 0) return { ok: false, error: created.stderr.trim() || "gh pr create failed" };
        prUrl = created.stdout.trim().split("\n").at(-1);
        steps.push("opened a pull request");
      }
      const summary = steps.length ? `${steps.join(", ")}.` : "Nothing to do.";
      this.log.info(`git: ${action} in ${cwd}: ${summary}`);
      return { ok: true, summary: summary[0].toUpperCase() + summary.slice(1), prUrl };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  // ---- The Pull requests page.

  async me(): Promise<string | null> {
    this.viewer ??= gh(process.cwd(), "api", "user", "--jq", ".login").then(({ code, stdout }) => (code === 0 ? stdout.trim() : null));
    return this.viewer;
  }

  /** The pull requests of the projects' GitHub repositories. */
  async pullRequests(cwds: string[], state: "open" | "closed" | "merged" | "all"): Promise<{ items: PullRequestListItem[]; me: string | null; errors: string[] }> {
    const repos = new Map<string, string>();
    for (const cwd of cwds) {
      const repo = await this.github(cwd);
      if (repo && !repos.has(repo.toLowerCase())) repos.set(repo.toLowerCase(), repo);
    }
    const me = await this.me();
    const errors: string[] = [];
    const fields = "number,title,url,state,isDraft,author,labels,additions,deletions,updatedAt,createdAt,reviewDecision,mergeable,statusCheckRollup,reviewRequests,headRefName,baseRefName";
    const lists = await Promise.all(
      [...repos.values()].map(async (repo) => {
        const { code, stdout, stderr } = await gh(process.cwd(), "pr", "list", "--repo", repo, "--state", state, "--limit", "100", "--json", fields);
        if (code !== 0) {
          errors.push(`${repo}: ${stderr.trim()}`);
          return [];
        }
        return (parseJson<GhPr[]>(stdout) ?? []).map((pr) => listItem(repo, pr, me));
      }),
    );
    return { items: lists.flat(), me, errors };
  }

  async pullRequest(repo: string, number: number): Promise<PullRequestDetail | string> {
    const fields =
      "number,title,url,state,isDraft,author,labels,additions,deletions,updatedAt,createdAt,reviewDecision,mergeable,statusCheckRollup,reviewRequests,headRefName,baseRefName,body,reviews,comments,commits,files";
    const { code, stdout, stderr } = await gh(process.cwd(), "pr", "view", String(number), "--repo", repo, "--json", fields);
    if (code !== 0) return stderr.trim() || "gh pr view failed";
    const pr = parseJson<GhPr & GhPrDetail>(stdout);
    if (!pr) return "Unreadable answer from gh.";
    const me = await this.me();
    return {
      ...listItem(repo, pr, me),
      body: pr.body ?? "",
      reviewRequests: (pr.reviewRequests ?? []).map((request) => ({ login: request.login ?? request.name ?? "?", avatarUrl: avatar(request.login) })),
      reviews: (pr.reviews ?? []).map((review) => ({ author: review.author?.login ?? "?", state: review.state, body: review.body ?? "", submittedAt: review.submittedAt })),
      comments: (pr.comments ?? []).map((comment) => ({ author: comment.author?.login ?? "?", body: comment.body ?? "", createdAt: comment.createdAt, avatarUrl: avatar(comment.author?.login) })),
      commits: (pr.commits ?? []).map((commit) => ({
        oid: commit.oid,
        headline: commit.messageHeadline,
        author: commit.authors?.[0]?.login ?? commit.authors?.[0]?.name ?? "?",
        committedDate: commit.committedDate,
      })),
      files: (pr.files ?? []).map((file) => ({ path: file.path, additions: file.additions, deletions: file.deletions })),
      checkRuns: (pr.statusCheckRollup ?? []).map((check) => ({
        name: check.name ?? check.context ?? "check",
        status: check.status ?? check.state ?? "",
        conclusion: check.conclusion ?? null,
        url: check.detailsUrl ?? check.targetUrl,
      })),
    };
  }

  async pullRequestDiff(repo: string, number: number): Promise<string> {
    const { stdout } = await gh(process.cwd(), "pr", "diff", String(number), "--repo", repo);
    return stdout;
  }

  async checkoutPullRequest(cwd: string, number: number): Promise<string | undefined> {
    const result = await gh(cwd, "pr", "checkout", String(number));
    return result.code === 0 ? undefined : result.stderr.trim() || "gh pr checkout failed";
  }

  async comment(repo: string, number: number, body: string): Promise<string | undefined> {
    const sent = await run("gh", ["pr", "comment", String(number), "--repo", repo, "--body-file", "-"], process.cwd(), body);
    return sent.code === 0 ? undefined : sent.stderr.trim();
  }
}

type GhPr = {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  author?: { login: string };
  labels?: { name: string; color: string }[];
  additions?: number;
  deletions?: number;
  updatedAt: string;
  createdAt: string;
  reviewDecision?: string;
  mergeable?: string;
  statusCheckRollup?: { name?: string; context?: string; status?: string; state?: string; conclusion?: string; detailsUrl?: string; targetUrl?: string }[];
  reviewRequests?: { login?: string; name?: string }[];
  headRefName: string;
  baseRefName: string;
};

type GhPrDetail = {
  body?: string;
  reviews?: { author?: { login: string }; state: string; body?: string; submittedAt: string }[];
  comments?: { author?: { login: string }; body?: string; createdAt: string }[];
  commits?: { oid: string; messageHeadline: string; committedDate: string; authors?: { login?: string; name?: string }[] }[];
  files?: { path: string; additions: number; deletions: number }[];
};

function listItem(repo: string, pr: GhPr, me: string | null): PullRequestListItem {
  return {
    repo,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: prState(pr.state),
    draft: pr.isDraft,
    author: { login: pr.author?.login ?? "?", avatarUrl: avatar(pr.author?.login) },
    labels: pr.labels ?? [],
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    updatedAt: pr.updatedAt,
    createdAt: pr.createdAt,
    reviewDecision: pr.reviewDecision || null,
    mergeable: pr.mergeable || null,
    checks: rollup(pr.statusCheckRollup ?? []),
    reviewRequested: me !== null && (pr.reviewRequests ?? []).some((request) => request.login?.toLowerCase() === me.toLowerCase()),
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
  };
}

function rollup(checks: NonNullable<GhPr["statusCheckRollup"]>): PullRequestListItem["checks"] {
  if (checks.length === 0) return null;
  const outcomes = checks.map((check) => (check.conclusion ?? check.state ?? "").toUpperCase());
  if (outcomes.some((outcome) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"].includes(outcome))) return "failure";
  if (outcomes.some((outcome) => outcome === "" || outcome === "PENDING" || outcome === "EXPECTED")) return "pending";
  return "success";
}

function avatar(login: string | undefined): string | undefined {
  return login ? `https://github.com/${encodeURIComponent(login)}.png?size=64` : undefined;
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

function sumNumstat(text: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of text.split("\n")) {
    const [a, r] = line.split("\t");
    added += Number(a) || 0;
    removed += Number(r) || 0;
  }
  return { added, removed };
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
