// What the main process reads of a branch's pull request on GitHub.

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
