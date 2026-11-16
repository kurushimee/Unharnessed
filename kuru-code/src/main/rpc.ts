// T3 Code's RPCs (contracts/rpc.ts), answered by kuru code's main process.
// T3 Code's window sends them to its server over a WebSocket; kuru code's
// window sends them here over IPC (renderer rt/rpc/client.ts), payloads and
// answers encoded by T3 Code's schemas. The ones answered here are those
// Unharnessed's machine has an answer for: git through `git`, GitHub through
// `gh`. Any other answers `unsupported`, which the window shows as such.
import type { WebContents } from "electron";
import type { LogOutputChannel } from "vscode";
import { hostname } from "node:os";
import { type Git, run } from "./git";
import { usagePricing, usageSummary } from "./usage";

type Answer = { ok: true; value: unknown } | { ok: false; error: unknown; unsupported?: boolean };
type Unary = (payload: any) => Promise<unknown>;
/** A stream: emits until it ends or the window drops it; returns its teardown. */
type Streamer = (payload: any, emit: (value: unknown) => void, end: (error?: unknown) => void) => () => void;

const git = (cwd: string, ...args: string[]) => run("git", args, cwd);
const gh = (cwd: string, ...args: string[]) => run("gh", args, cwd);

class RpcFailure extends Error {
  constructor(readonly encoded: unknown) {
    super(typeof encoded === "object" && encoded && "detail" in encoded ? String((encoded as { detail: unknown }).detail) : "failed");
  }
}

function commandError(operation: string, cwd: string, args: string[], result: { code: number; stderr: string; stdout: string }) {
  return new RpcFailure({
    _tag: "GitCommandError",
    operation,
    command: `git ${args.join(" ")}`,
    cwd,
    exitCode: result.code,
    detail: (result.stderr || result.stdout).trim() || `git ${args[0]} failed`,
  });
}

function managerError(operation: string, cwd: string, detail: string) {
  return new RpcFailure({ _tag: "GitManagerError", operation, cwd, detail: detail.trim() || `${operation} failed` });
}

async function gitOk(operation: string, cwd: string, ...args: string[]): Promise<string> {
  const result = await git(cwd, ...args);
  if (result.code !== 0) throw commandError(operation, cwd, args, result);
  return result.stdout;
}

const nonEmpty = (value: string | null | undefined) => (value && value.trim() ? value.trim() : undefined);

// ---- Status: T3 Code's VcsStatusLocalResult and VcsStatusRemoteResult.

type LocalStatus = {
  isRepo: boolean;
  sourceControlProvider?: { kind: string; name: string; baseUrl: string };
  hasPrimaryRemote: boolean;
  isDefaultRef: boolean;
  refName: string | null;
  hasWorkingTreeChanges: boolean;
  workingTree: { rootPath?: string; files: { path: string; insertions: number; deletions: number }[]; insertions: number; deletions: number };
  branchChanges?: { baseRef: string | null; insertions: number; deletions: number };
};
type RemoteStatus = {
  hasUpstream: boolean;
  aheadCount: number;
  behindCount: number;
  aheadOfDefaultCount?: number;
  pr: null | { number: number; title: string; url: string; baseRef: string; headRef: string; state: "open" | "closed" | "merged"; isDraft?: boolean };
};

const NOT_A_REPO: LocalStatus = {
  isRepo: false,
  hasPrimaryRemote: false,
  isDefaultRef: false,
  refName: null,
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
};

function numstat(text: string): Map<string, { insertions: number; deletions: number }> {
  const files = new Map<string, { insertions: number; deletions: number }>();
  for (const line of text.split("\n")) {
    const [added, removed, ...rest] = line.split("\t");
    const path = rest.join("\t").trim();
    if (!path) continue;
    const known = files.get(path) ?? { insertions: 0, deletions: 0 };
    files.set(path, { insertions: known.insertions + (Number(added) || 0), deletions: known.deletions + (Number(removed) || 0) });
  }
  return files;
}

async function defaultBranchOf(cwd: string): Promise<{ name: string; ref: string } | null> {
  const symbolic = await git(cwd, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
  if (symbolic.code === 0 && symbolic.stdout.trim()) {
    const ref = symbolic.stdout.trim();
    return { name: ref.replace(/^origin\//, ""), ref };
  }
  for (const candidate of ["main", "master"]) {
    if ((await git(cwd, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${candidate}`)).code === 0) return { name: candidate, ref: `origin/${candidate}` };
  }
  for (const candidate of ["main", "master"]) {
    if ((await git(cwd, "rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`)).code === 0) return { name: candidate, ref: candidate };
  }
  return null;
}

async function localStatus(cwd: string): Promise<LocalStatus> {
  const top = await git(cwd, "rev-parse", "--show-toplevel");
  if (top.code !== 0) return NOT_A_REPO;
  const rootPath = top.stdout.trim();
  const [porcelain, remotes, tracked, origin, defaultBranch] = await Promise.all([
    git(cwd, "status", "--porcelain=v1", "--branch", "--untracked-files=all", "-z"),
    git(cwd, "remote"),
    git(cwd, "diff", "HEAD", "--numstat"),
    git(cwd, "remote", "get-url", "origin"),
    defaultBranchOf(cwd),
  ]);
  const head = porcelain.stdout.split("\0")[0] ?? "";
  const headName = /^## (?:No commits yet on )?([^.\s]+(?:\.(?!\.)[^.\s]*)*)/.exec(head)?.[1] ?? null;
  const refName = headName && !head.startsWith("## HEAD (no branch)") ? headName : null;
  const counts = numstat(tracked.stdout);
  const files: LocalStatus["workingTree"]["files"] = [];
  for (const entry of porcelain.stdout.split("\0").slice(1)) {
    if (entry.length < 4) continue;
    const path = entry.slice(3);
    if (files.some((file) => file.path === path)) continue;
    files.push({ path, ...(counts.get(path) ?? { insertions: 0, deletions: 0 }) });
  }
  const hasPrimaryRemote = remotes.stdout.trim().length > 0;
  const url = origin.code === 0 ? origin.stdout.trim() : "";
  const github = /github\.com[:/]/i.test(url);
  let branchChanges: LocalStatus["branchChanges"];
  if (defaultBranch && refName && refName !== defaultBranch.name) {
    const mergeBase = await git(cwd, "merge-base", defaultBranch.ref, "HEAD");
    if (mergeBase.code === 0) {
      const diff = numstat((await git(cwd, "diff", "--numstat", mergeBase.stdout.trim())).stdout);
      let insertions = 0;
      let deletions = 0;
      for (const file of diff.values()) {
        insertions += file.insertions;
        deletions += file.deletions;
      }
      branchChanges = { baseRef: defaultBranch.name, insertions, deletions };
    }
  }
  return {
    isRepo: true,
    ...(github ? { sourceControlProvider: { kind: "github", name: "GitHub", baseUrl: "https://github.com" } } : {}),
    hasPrimaryRemote,
    isDefaultRef: refName !== null && refName === defaultBranch?.name,
    refName,
    hasWorkingTreeChanges: files.length > 0,
    workingTree: {
      rootPath,
      files,
      insertions: files.reduce((sum, file) => sum + file.insertions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    },
    ...(branchChanges ? { branchChanges } : {}),
  };
}

async function remoteStatus(gitService: Git, cwd: string, local: LocalStatus): Promise<RemoteStatus | null> {
  if (!local.isRepo) return null;
  const [ab, defaultBranch] = await Promise.all([
    git(cwd, "rev-list", "--left-right", "--count", "HEAD...@{u}"),
    defaultBranchOf(cwd),
  ]);
  const [ahead, behind] = ab.code === 0 ? ab.stdout.trim().split(/\s+/).map(Number) : [0, 0];
  let aheadOfDefaultCount: number | undefined;
  if (defaultBranch) {
    const count = await git(cwd, "rev-list", "--count", `${defaultBranch.ref}..HEAD`);
    if (count.code === 0) aheadOfDefaultCount = Number(count.stdout.trim()) || 0;
  }
  let pr: RemoteStatus["pr"] = null;
  if (local.refName && !local.isDefaultRef && local.sourceControlProvider) {
    const found = await gitService.pullRequestFor(cwd, local.refName);
    if (found) {
      pr = {
        number: found.number,
        title: found.title,
        url: found.url,
        baseRef: found.baseRefName ?? defaultBranch?.name ?? "main",
        headRef: found.headRefName ?? local.refName,
        state: found.state,
        isDraft: found.draft,
      };
    }
  }
  return {
    hasUpstream: ab.code === 0,
    aheadCount: ahead || 0,
    behindCount: behind || 0,
    ...(aheadOfDefaultCount === undefined ? {} : { aheadOfDefaultCount }),
    pr,
  };
}

// ---- Refs: T3 Code's VcsListRefsResult.

async function listRefs(cwd: string, input: { query?: string; cursor?: number; limit?: number; refKind?: "all" | "local" | "remote" }) {
  const top = await git(cwd, "rev-parse", "--show-toplevel");
  if (top.code !== 0) return { refs: [], isRepo: false, hasPrimaryRemote: false, nextCursor: null, totalCount: 0 };
  const [refs, remotes, worktrees, defaultBranch, prefix] = await Promise.all([
    gitOk("listRefs", cwd, "for-each-ref", "--sort=-committerdate", "--format=%(refname)\t%(HEAD)\t%(upstream)", "refs/heads", "refs/remotes"),
    git(cwd, "remote"),
    git(cwd, "worktree", "list", "--porcelain"),
    defaultBranchOf(cwd),
    git(cwd, "rev-parse", "--show-prefix"),
  ]);
  const worktreeByBranch = new Map<string, string>();
  let path: string | null = null;
  for (const line of worktrees.stdout.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice(9).trim();
    else if (line.startsWith("branch refs/heads/") && path) worktreeByBranch.set(line.slice(18).trim(), path);
  }
  const query = input.query?.toLowerCase();
  const all = [];
  for (const line of refs.split("\n")) {
    const [ref, head, upstream] = line.split("\t");
    if (!ref || ref.endsWith("/HEAD")) continue;
    const isRemote = ref.startsWith("refs/remotes/");
    if (input.refKind === "local" && isRemote) continue;
    if (input.refKind === "remote" && !isRemote) continue;
    const name = ref.replace(/^refs\/(heads|remotes)\//, "");
    if (query && !name.toLowerCase().includes(query)) continue;
    const remoteName = isRemote ? name.split("/")[0] : undefined;
    all.push({
      name,
      ...(isRemote ? { isRemote: true, remoteName } : {}),
      ...(nonEmpty(upstream) ? { upstreamRef: upstream!.trim() } : {}),
      current: head === "*",
      isDefault: isRemote ? name === defaultBranch?.ref : name === defaultBranch?.name,
      worktreePath: isRemote ? null : (worktreeByBranch.get(name) ?? null),
    });
  }
  all.sort((a, b) => Number(b.current) - Number(a.current) || Number(b.isDefault) - Number(a.isDefault));
  const cursor = input.cursor ?? 0;
  const limit = input.limit ?? 100;
  const page = all.slice(cursor, cursor + limit);
  return {
    isAtRepositoryRoot: prefix.stdout.trim() === "",
    refs: page,
    isRepo: true,
    hasPrimaryRemote: remotes.stdout.trim().length > 0,
    nextCursor: cursor + limit < all.length ? cursor + limit : null,
    totalCount: all.length,
  };
}

// ---- Stacked actions: commit, push, open a pull request, in T3 Code's progress events.

type Phase = "branch" | "commit" | "push" | "pr";

async function runStackedAction(
  input: { actionId: string; cwd: string; action: string; commitMessage?: string; featureBranch?: boolean; filePaths?: string[] },
  emit: (event: object) => void,
  writeMessage: (cwd: string) => Promise<string>,
  log: LogOutputChannel,
): Promise<void> {
  const { actionId, cwd, action } = input;
  const base = { actionId, cwd, action };
  const commits = action === "commit" || action === "commit_push" || action === "commit_push_pr";
  const pushes = action !== "commit";
  const opensPr = action === "create_pr" || action === "commit_push_pr";
  const phases: Phase[] = [...(input.featureBranch ? (["branch"] as const) : []), ...(commits ? (["commit"] as const) : []), ...(pushes ? (["push"] as const) : []), ...(opensPr ? (["pr"] as const) : [])];
  emit({ ...base, kind: "action_started", phases });
  let phase: Phase | null = null;
  const start = (next: Phase, label: string) => {
    phase = next;
    emit({ ...base, kind: "phase_started", phase: next, label });
  };
  const result = {
    action,
    branch: { status: "skipped_not_requested" } as { status: string; name?: string },
    commit: { status: commits ? "skipped_no_changes" : "skipped_not_requested" } as { status: string; commitSha?: string; subject?: string },
    push: { status: "skipped_not_requested" } as { status: string; branch?: string; upstreamBranch?: string; setUpstream?: boolean },
    pr: { status: "skipped_not_requested" } as { status: string; url?: string; number?: number; baseBranch?: string; headBranch?: string; title?: string },
    toast: { title: "Done", cta: { kind: "none" } } as { title: string; description?: string; cta: object },
  };
  try {
    let message = nonEmpty(input.commitMessage);
    if (input.featureBranch) {
      start("branch", "Creating branch");
      message ??= await writeMessage(cwd);
      const slug = message.split("\n", 1)[0]!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "changes";
      const name = `kuru/${slug}`;
      await gitOk("createBranch", cwd, "checkout", "-b", name);
      result.branch = { status: "created", name };
    }
    if (commits) {
      start("commit", "Committing");
      if (input.filePaths?.length) await gitOk("stage", cwd, "add", "-A", "--", ...input.filePaths);
      else await gitOk("stage", cwd, "add", "-A");
      const staged = await git(cwd, "diff", "--cached", "--quiet");
      if (staged.code !== 0) {
        message ??= await writeMessage(cwd);
        const commit = await run("git", ["commit", "-F", "-"], cwd, message);
        if (commit.code !== 0) throw commandError("commit", cwd, ["commit"], commit);
        const sha = (await gitOk("commit", cwd, "rev-parse", "HEAD")).trim();
        result.commit = { status: "created", commitSha: sha, subject: message.split("\n", 1)[0]!.trim() };
      }
    }
    const branch = (await git(cwd, "rev-parse", "--abbrev-ref", "HEAD")).stdout.trim();
    if (pushes) {
      start("push", "Pushing");
      const upstream = await git(cwd, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
      const ahead = upstream.code === 0 ? Number((await git(cwd, "rev-list", "--count", "@{u}..HEAD")).stdout.trim()) || 0 : 1;
      if (upstream.code === 0 && ahead === 0) {
        result.push = { status: "skipped_up_to_date", branch, upstreamBranch: upstream.stdout.trim() };
      } else {
        const args = upstream.code === 0 ? ["push"] : ["push", "-u", "origin", "HEAD"];
        const push = await git(cwd, ...args);
        if (push.code !== 0) throw commandError("push", cwd, args, push);
        result.push = { status: "pushed", branch, upstreamBranch: upstream.code === 0 ? upstream.stdout.trim() : `origin/${branch}`, setUpstream: upstream.code !== 0 };
      }
    }
    if (opensPr) {
      start("pr", "Opening pull request");
      const existing = await gh(cwd, "pr", "view", "--json", "number,url,title,baseRefName,headRefName,state");
      const open = existing.code === 0 ? (JSON.parse(existing.stdout) as { number: number; url: string; title: string; baseRefName: string; headRefName: string; state: string }) : null;
      if (open && open.state === "OPEN") {
        result.pr = { status: "opened_existing", url: open.url, number: open.number, baseBranch: open.baseRefName, headBranch: open.headRefName, title: open.title };
      } else {
        const created = await gh(cwd, "pr", "create", "--fill");
        if (created.code !== 0) throw managerError("createPullRequest", cwd, created.stderr || created.stdout);
        const url = created.stdout.trim().split("\n").at(-1)!.trim();
        const view = await gh(cwd, "pr", "view", url, "--json", "number,title,baseRefName,headRefName");
        const pr = view.code === 0 ? (JSON.parse(view.stdout) as { number: number; title: string; baseRefName: string; headRefName: string }) : null;
        result.pr = { status: "created", url, ...(pr ? { number: pr.number, title: pr.title, baseBranch: pr.baseRefName, headBranch: pr.headRefName } : {}) };
      }
    }
    result.toast = toastOf(result);
    log.info(`rpc: ${action} in ${cwd}: ${result.toast.title}`);
    emit({ ...base, kind: "action_finished", result });
  } catch (error) {
    const message = error instanceof RpcFailure ? error.message : String(error);
    log.warn(`rpc: ${action} in ${cwd} failed: ${message}`);
    emit({ ...base, kind: "action_failed", phase, message: message.trim() || "The action failed." });
  }
}

function toastOf(result: { commit: { status: string; subject?: string }; push: { status: string; branch?: string }; pr: { status: string; url?: string; number?: number } }) {
  if (result.pr.url) {
    return {
      title: result.pr.status === "created" ? `Opened pull request #${result.pr.number ?? ""}`.trim() : `Pull request #${result.pr.number ?? ""} is open`.trim(),
      cta: { kind: "open_pr", label: "View PR", url: result.pr.url },
    };
  }
  if (result.push.status === "pushed") return { title: `Pushed ${result.push.branch ?? ""}`.trim(), ...(result.commit.subject ? { description: result.commit.subject } : {}), cta: { kind: "none" } };
  if (result.commit.status === "created") return { title: "Committed", ...(result.commit.subject ? { description: result.commit.subject } : {}), cta: { kind: "run_action", label: "Push", action: { kind: "push" } } };
  if (result.push.status === "skipped_up_to_date") return { title: "Already up to date", cta: { kind: "none" } };
  return { title: "No changes to commit", cta: { kind: "none" } };
}

// ---- The service.

export function createRpc(options: {
  git: Git;
  log: LogOutputChannel;
  writeMessage: (cwd: string) => Promise<string>;
  /** After a command that changes a checkout: threads read their branch again. */
  changed: () => void;
}) {
  const { git: gitService, log, writeMessage } = options;
  /** Status watchers by folder: a refresh reads it again and tells each. */
  const statusWatchers = new Map<string, Set<() => void>>();
  const touch = (cwd: string) => {
    for (const [watched, watchers] of statusWatchers) {
      if (watched === cwd || watched.startsWith(cwd) || cwd.startsWith(watched)) for (const watcher of watchers) watcher();
    }
    options.changed();
  };
  const watch = (cwd: string, watcher: () => void) => {
    let set = statusWatchers.get(cwd);
    if (!set) statusWatchers.set(cwd, (set = new Set()));
    set.add(watcher);
    return () => {
      set!.delete(watcher);
      if (set!.size === 0) statusWatchers.delete(cwd);
    };
  };

  const unary: Record<string, Unary> = {
    "server.getUsageSummary": (input) => usageSummary(input, hostname()),
    "server.refreshUsageRates": async () => usagePricing(),
    "vcs.listRefs": (input) => listRefs(input.cwd, input),
    "vcs.refreshStatus": async ({ cwd }) => {
      touch(cwd);
      const local = await localStatus(cwd);
      return { ...local, ...((await remoteStatus(gitService, cwd, local)) ?? { hasUpstream: false, aheadCount: 0, behindCount: 0, pr: null }) };
    },
    "vcs.refreshBranch": async ({ cwd }) => {
      touch(cwd);
    },
    "vcs.switchRef": async ({ cwd, refName }) => {
      const remote = (await git(cwd, "rev-parse", "--verify", "--quiet", `refs/heads/${refName}`)).code !== 0 && (await git(cwd, "rev-parse", "--verify", "--quiet", `refs/remotes/${refName}`)).code === 0;
      if (remote) await gitOk("switchRef", cwd, "checkout", "--track", refName);
      else await gitOk("switchRef", cwd, "checkout", refName);
      touch(cwd);
      const name = (await git(cwd, "rev-parse", "--abbrev-ref", "HEAD")).stdout.trim();
      return { refName: name && name !== "HEAD" ? name : null };
    },
    "vcs.createRef": async ({ cwd, refName, switchRef }) => {
      if (switchRef) await gitOk("createRef", cwd, "checkout", "-b", refName);
      else await gitOk("createRef", cwd, "branch", refName);
      touch(cwd);
      return { refName };
    },
    "vcs.init": async ({ cwd }) => {
      await gitOk("init", cwd, "init");
      touch(cwd);
    },
    "vcs.pull": async ({ cwd }) => {
      const before = (await gitOk("pull", cwd, "rev-parse", "HEAD")).trim();
      await gitOk("pull", cwd, "pull", "--ff-only");
      const after = (await gitOk("pull", cwd, "rev-parse", "HEAD")).trim();
      const refName = (await gitOk("pull", cwd, "rev-parse", "--abbrev-ref", "HEAD")).trim();
      const upstream = await git(cwd, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
      touch(cwd);
      return { status: before === after ? "skipped_up_to_date" : "pulled", refName, upstreamRef: upstream.code === 0 ? upstream.stdout.trim() : null };
    },
    "vcs.createWorktree": async ({ cwd, refName, newRefName, baseRefName, path }) => {
      const repoName = (await gitOk("createWorktree", cwd, "rev-parse", "--show-toplevel")).trim();
      const target = path ?? `${repoName}.worktrees/${(newRefName ?? refName).replace(/[\\/]/g, "-")}`;
      const args = newRefName ? ["worktree", "add", "-b", newRefName, target, baseRefName ?? refName] : ["worktree", "add", target, refName];
      await gitOk("createWorktree", cwd, ...args);
      touch(cwd);
      return { worktree: { path: target, refName: newRefName ?? refName } };
    },
    "vcs.removeWorktree": async ({ cwd, path, force }) => {
      await gitOk("removeWorktree", cwd, "worktree", "remove", ...(force ? ["--force"] : []), path);
      touch(cwd);
    },
    "git.resolvePullRequest": async ({ cwd, reference }) => {
      const view = await gh(cwd, "pr", "view", String(reference), "--json", "number,title,url,baseRefName,headRefName,state");
      if (view.code !== 0) throw managerError("resolvePullRequest", cwd, view.stderr);
      const pr = JSON.parse(view.stdout) as { number: number; title: string; url: string; baseRefName: string; headRefName: string; state: string };
      return { pullRequest: { number: pr.number, title: pr.title, url: pr.url, baseBranch: pr.baseRefName, headBranch: pr.headRefName, state: pr.state.toLowerCase() } };
    },
  };

  const streams: Record<string, Streamer> = {
    subscribeVcsStatus: ({ cwd, includeRemote }, emit, end) => {
      let closed = false;
      let reading = false;
      let again = false;
      let lastLocal = "";
      let lastRemote = "";
      const read = async () => {
        if (reading) {
          again = true;
          return;
        }
        reading = true;
        try {
          const local = await localStatus(cwd);
          if (closed) return;
          const localText = JSON.stringify(local);
          const first = lastLocal === "";
          if (first || localText !== lastLocal) {
            lastLocal = localText;
            emit(first ? { _tag: "snapshot", local, remote: null } : { _tag: "localUpdated", local });
          }
          if (includeRemote !== false) {
            const remote = await remoteStatus(gitService, cwd, local);
            if (closed) return;
            const remoteText = JSON.stringify(remote);
            if (remoteText !== lastRemote) {
              lastRemote = remoteText;
              emit({ _tag: "remoteUpdated", remote });
            }
          }
        } catch (error) {
          if (!closed) end(error instanceof RpcFailure ? error.encoded : { _tag: "GitManagerError", operation: "status", cwd, detail: String(error) });
          closed = true;
        } finally {
          reading = false;
          if (again && !closed) {
            again = false;
            void read();
          }
        }
      };
      void read();
      // Edits made by the agent or in another app: read again every few seconds.
      const timer = setInterval(() => void read(), 5_000);
      const unwatch = watch(cwd, () => void read());
      return () => {
        closed = true;
        clearInterval(timer);
        unwatch();
      };
    },
    subscribeVcsBranch: ({ cwd }, emit) => {
      let closed = false;
      let last: string | null | undefined;
      const read = async () => {
        const name = await gitService.branch(cwd);
        const refName = name ?? null;
        if (closed || refName === last) return;
        last = refName;
        emit({ refName });
      };
      void read();
      const timer = setInterval(() => void read(), 15_000);
      const unwatch = watch(cwd, () => void read());
      return () => {
        closed = true;
        clearInterval(timer);
        unwatch();
      };
    },
    "git.runStackedAction": (input, emit, end) => {
      void runStackedAction(input, emit, writeMessage, log).finally(() => {
        touch(input.cwd);
        end();
      });
      return () => {};
    },
  };

  const live = new Map<string, () => void>();

  return {
    async call(tag: string, payload: unknown): Promise<Answer> {
      const handler = unary[tag];
      if (!handler) return { ok: false, error: `kuru code does not answer ${tag}.`, unsupported: true };
      try {
        return { ok: true, value: (await handler(payload)) ?? null };
      } catch (error) {
        if (error instanceof RpcFailure) return { ok: false, error: error.encoded };
        log.warn(`rpc ${tag} failed: ${String(error)}`);
        return { ok: false, error: String(error), unsupported: true };
      }
    },
    subscribe(sender: WebContents, id: string, tag: string, payload: unknown): Answer {
      const streamer = streams[tag];
      if (!streamer) return { ok: false, error: `kuru code does not answer ${tag}.`, unsupported: true };
      const send = (message: object) => {
        if (!sender.isDestroyed()) sender.send("rpc-event", { id, ...message });
      };
      let ended = false;
      const stop = streamer(
        payload,
        (value) => !ended && send({ value }),
        (error) => {
          if (ended) return;
          ended = true;
          live.delete(id);
          send(error === undefined ? { end: true } : { end: true, error });
        },
      );
      if (!ended) live.set(id, stop);
      else stop();
      sender.once("destroyed", () => this.unsubscribe(id));
      return { ok: true, value: null };
    },
    unsubscribe(id: string): void {
      const stop = live.get(id);
      live.delete(id);
      stop?.();
    },
  };
}
