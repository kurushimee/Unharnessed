// Adapted from T3 Code's lib/openPullRequestLink.ts. T3 Code opens a pull
// request in the thread's right panel; kuru code opens it on its Pull requests
// page, and a modified click (or one on a non-GitHub link) in the browser.
import type { MouseEvent } from "react";
import type { ScopedThreadRef } from "~/contracts";
import { ensureLocalApi } from "~/localApi";
import { set } from "~/state";

function shouldOpenPullRequestExternally(event: MouseEvent<HTMLElement>): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1;
}

function githubPullRequest(url: string): { repo: string; number: number } | null {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i.exec(url);
  return match ? { repo: match[1]!, number: Number(match[2]) } : null;
}

export function useOpenPrLink(_threadRef?: ScopedThreadRef) {
  return (event: MouseEvent<HTMLElement>, prUrl: string, _targetThreadRef?: ScopedThreadRef) => {
    if (event.button > 1) return false;
    event.stopPropagation();
    event.preventDefault();
    const selected = githubPullRequest(prUrl);
    if (!shouldOpenPullRequestExternally(event) && selected !== null) {
      set({ main: { kind: "prs", selected } });
      return false;
    }
    void ensureLocalApi().shell.openExternal(prUrl);
    return false;
  };
}
