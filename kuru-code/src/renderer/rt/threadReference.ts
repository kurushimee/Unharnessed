// Adapted from T3 Code's client-runtime threadReference.ts. T3 Code copies a
// hosted link that pastes back into a composer as a chip; an Unharnessed
// thread is a session, so copying it gives its title and session ID, which
// the agent can resume or read.
import type { ScopedThreadRef } from "~/contracts";
import type { ThreadPullRequestLink } from "~/contracts";
import { resolveThreadCurrentPullRequestLink } from "./threadPullRequests";

export interface ThreadReferenceCopyTarget {
  readonly kind: "pull-request" | "thread";
  readonly value: string;
  readonly description: string;
  readonly clipboardTarget: string;
  readonly successTitle: string;
  readonly failureTitle: string;
}

export function threadChipCopyTarget(
  threadRef: ScopedThreadRef,
  title: string,
  _hostedAppUrl?: string,
): ThreadReferenceCopyTarget {
  const shown = title.trim() || "Untitled thread";
  return {
    kind: "thread",
    value: `${shown} (session ${threadRef.threadId})`,
    description: shown,
    clipboardTarget: "thread",
    successTitle: "Thread copied",
    failureTitle: "Failed to copy thread",
  };
}

export function resolveThreadReferenceCopyTarget(input: {
  readonly threadRef: ScopedThreadRef;
  readonly title: string;
  readonly openPanelPullRequestUrl?: string | null | undefined;
  readonly pullRequests?: ReadonlyArray<ThreadPullRequestLink> | undefined;
  readonly linkedPullRequestUrl?: string | null;
  readonly hostedAppUrl?: string;
}): ThreadReferenceCopyTarget | null {
  if (input.openPanelPullRequestUrl === null) return null;
  const pullRequestUrl =
    input.openPanelPullRequestUrl ??
    resolveThreadCurrentPullRequestLink(input.pullRequests ?? [])?.url ??
    input.linkedPullRequestUrl;
  return pullRequestUrl
    ? {
        kind: "pull-request",
        value: pullRequestUrl,
        description: pullRequestUrl,
        clipboardTarget: "pull request link",
        successTitle: "PR link copied",
        failureTitle: "Failed to copy PR link",
      }
    : threadChipCopyTarget(input.threadRef, input.title, input.hostedAppUrl);
}
