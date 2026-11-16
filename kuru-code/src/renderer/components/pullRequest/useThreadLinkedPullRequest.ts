import {
  type EnvironmentId,
  type ProjectId,
  type ScopedThreadRef,
  type ThreadLinkedPullRequest,
  type VcsStatusResult,
} from "~/contracts";

/**
 * From T3 Code's useThreadLinkedPullRequest, which relinked a thread's replaced pull request.
 * kuru code links no pull request to a thread: it finds a thread's from its branch, so the
 * persisted link, if any, is the one shown.
 */
export function useThreadLinkedPullRequest(input: {
  readonly serverThreadRef: ScopedThreadRef | null;
  readonly environmentId: EnvironmentId | null;
  readonly persisted: ThreadLinkedPullRequest | null;
  readonly projectId: ProjectId | null;
  readonly projectRepository: string | null;
  readonly threadBranch: string | null;
  readonly gitStatus: Pick<VcsStatusResult, "refName" | "pr"> | null;
}) {
  const linked = input.persisted;
  return {
    linked,
    linkedKey: linked ? JSON.stringify([linked.projectId, linked.repository, linked.number]) : null,
    hasDetail: linked !== null,
  };
}
