import type { VcsRef } from "~/contracts";
import { sanitizeNewRefName } from "~/shared/git";
import { workspaceRelativeFilePath } from "~/shared/path";
export { deriveLocalBranchNameFromRemoteRef, sanitizeNewRefName } from "~/shared/git";


export function shouldShowComposerContextStrip(input: {
  isDraftHeroState: boolean;
  persistInActiveThreads: boolean;
  hasActiveProject: boolean;
  isGitRepo: boolean;
}): boolean {
  return input.hasActiveProject && input.isGitRepo && (input.isDraftHeroState || input.persistInActiveThreads);
}

// Hysteresis prevents labels and icons from flapping at the width boundary.
const CONTEXT_STRIP_COMPACT_EXPAND_HYSTERESIS_PX = 16;

export function resolveContextStripLabelsCompact(input: {
  compact: boolean;
  neededWidth: number;
  availableWidth: number;
}): boolean {
  return input.compact
    ? input.neededWidth > input.availableWidth - CONTEXT_STRIP_COMPACT_EXPAND_HYSTERESIS_PX
    : input.neededWidth > input.availableWidth;
}

export function resolveBranchToolbarPrBranch(input: {
  activeThreadBranch: string | null;
  resolvedActiveBranch: string | null;
}): string | null {
  return input.activeThreadBranch === input.resolvedActiveBranch ? input.activeThreadBranch : null;
}

export function resolveLocalCheckoutBranchMismatch(input: {
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  currentGitBranch: string | null;
}): { threadBranch: string; currentBranch: string } | null {
  const { activeWorktreePath, activeThreadBranch, currentGitBranch } = input;
  if (activeWorktreePath !== null) {
    return null;
  }
  if (!activeThreadBranch || !currentGitBranch || activeThreadBranch === currentGitBranch) {
    return null;
  }
  return { threadBranch: activeThreadBranch, currentBranch: currentGitBranch };
}

export function resolveBranchSelectionTarget(input: {
  activeProjectCwd: string;
  activeProjectCheckoutRoot?: string | undefined;
  activeWorktreePath: string | null;
  refName: Pick<VcsRef, "isDefault" | "worktreePath">;
}): {
  checkoutCwd: string;
  nextWorktreePath: string | null;
  reuseExistingWorktree: boolean;
} {
  const { activeProjectCwd, activeWorktreePath, refName } = input;

  if (refName.worktreePath) {
    // Until the project's checkout root loads, a checkout containing the project counts as its own.
    const isProjectCheckout =
      input.activeProjectCheckoutRoot === undefined
        ? workspaceRelativeFilePath(activeProjectCwd, refName.worktreePath) !== null
        : workspaceRelativeFilePath(input.activeProjectCheckoutRoot, refName.worktreePath) === ".";
    return {
      checkoutCwd: refName.worktreePath,
      nextWorktreePath: isProjectCheckout ? null : refName.worktreePath,
      reuseExistingWorktree: true,
    };
  }

  const nextWorktreePath =
    activeWorktreePath !== null && refName.isDefault ? null : activeWorktreePath;

  return {
    checkoutCwd: nextWorktreePath ?? activeProjectCwd,
    nextWorktreePath,
    reuseExistingWorktree: false,
  };
}

export function shouldIncludeBranchPickerItem(input: {
  itemValue: string;
  normalizedQuery: string;
  createBranchItemValue: string | null;
  checkoutPullRequestItemValue: string | null;
}): boolean {
  const { itemValue, normalizedQuery, createBranchItemValue, checkoutPullRequestItemValue } = input;

  if (normalizedQuery.length === 0) {
    return true;
  }

  if (createBranchItemValue && itemValue === createBranchItemValue) {
    return true;
  }

  if (checkoutPullRequestItemValue && itemValue === checkoutPullRequestItemValue) {
    return true;
  }

  const lowerItemValue = itemValue.toLowerCase();
  if (lowerItemValue.includes(normalizedQuery)) {
    return true;
  }

  const sanitizedQuery = sanitizeNewRefName(normalizedQuery);
  return (
    sanitizedQuery.length > 0 &&
    sanitizedQuery !== normalizedQuery &&
    lowerItemValue.includes(sanitizedQuery)
  );
}

export function resolveBranchTriggerLabel(input: { resolvedActiveBranch: string | null }): string {
  return input.resolvedActiveBranch ?? "Select ref";
}
