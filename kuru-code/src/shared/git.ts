// What the window shows of a project's git repository and of GitHub.

export type GitStatus =
  | { repo: false }
  | {
      repo: true;
      /** `null`: a detached HEAD. */
      branch: string | null;
      upstream: string | null;
      ahead: number;
      behind: number;
      /** Files changed in the working tree, staged or not, untracked included. */
      changedFiles: number;
      /** The repository's default branch (`main`), as its origin names it. */
      defaultBranch: string | null;
      /** Commits on this branch that are not on the default branch. */
      aheadOfDefault: number;
      /** Lines added and removed against the default branch's merge base, the working tree included. */
      diff: { added: number; removed: number; against: string } | null;
      /** `owner/name` on GitHub, when origin is there. */
      github: string | null;
      hasRemote: boolean;
      pr: PullRequestSummary | null;
    };

export type PullRequestSummary = {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  baseRefName?: string;
  headRefName?: string;
};

export type Branch = { name: string; remote: boolean; current: boolean; updated: number };

export type ChangedFile = { path: string; added: number; removed: number; status: string };

export type GitAction = "commit" | "push" | "commit_push" | "commit_push_pr" | "create_pr" | "pull";

export type GitActionRequest = {
  cwd: string;
  action: GitAction;
  /** The commit message; empty: one is written from the changes. */
  message?: string;
  /** The pull request's title and body; empty: GitHub fills them from the commits. */
  prTitle?: string;
  prBody?: string;
  draft?: boolean;
  /** Commit onto a new branch first (from the default branch). */
  newBranch?: string;
};

export type GitActionResult = { ok: true; summary: string; prUrl?: string } | { ok: false; error: string };

/** A pull request on the Pull requests page. */
export type PullRequestListItem = {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  author: { login: string; avatarUrl?: string };
  labels: { name: string; color: string }[];
  additions: number;
  deletions: number;
  updatedAt: string;
  createdAt: string;
  reviewDecision: string | null;
  mergeable: string | null;
  checks: "success" | "failure" | "pending" | null;
  reviewRequested: boolean;
  headRefName: string;
  baseRefName: string;
};

export type PullRequestDetail = PullRequestListItem & {
  body: string;
  reviewRequests: { login: string; avatarUrl?: string }[];
  reviews: { author: string; state: string; body: string; submittedAt: string }[];
  comments: { author: string; body: string; createdAt: string; avatarUrl?: string }[];
  commits: { oid: string; headline: string; author: string; committedDate: string }[];
  files: { path: string; additions: number; deletions: number }[];
  checkRuns: { name: string; status: string; conclusion: string | null; url?: string }[];
};
