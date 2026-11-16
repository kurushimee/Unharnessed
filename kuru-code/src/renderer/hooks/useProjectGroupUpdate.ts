// Adapted from T3 Code's hooks/useProjectGroupUpdate.ts: changes to a project
// (its title, icon, pin, archive) written to each checkout of it. kuru code's
// projects live in its main process's state file.
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "~/rt/state/runtime";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";

import type { ProjectIconOverride } from "@shared/protocol";
import { invoke } from "~/bridge";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import type { SidebarProjectGroupMember } from "../sidebarProjectGrouping";

export type ProjectGroupUpdate = Partial<{
  /** `null`: back to the folder's name. */
  title: string | null;
  faviconPath: string | null;
  projectIcon: ProjectIconOverride | null;
  pinned: boolean;
  archived: boolean;
}>;

type ProjectGroupMember = Pick<
  SidebarProjectGroupMember,
  "environmentId" | "id" | "environmentLabel"
>;

export function useProjectGroupUpdate() {
  const updateProjectGroup = async <TMember extends ProjectGroupMember>(
    members: ReadonlyArray<TMember>,
    input: ProjectGroupUpdate | ((member: TMember) => ProjectGroupUpdate),
    failureTitle: string,
  ): Promise<AtomCommandResult<void, unknown>> => {
    for (const member of members) {
      const result = await settlePromise(() =>
        invoke<string | null>("projects.update", {
          id: member.id,
          change: typeof input === "function" ? input(member) : input,
        }),
      );
      if (result._tag === "Success" && typeof result.value === "string") {
        return failWith(failureTitle, result.value);
      }
      if (result._tag === "Failure") {
        reportProjectFailure(failureTitle, result);
        return AsyncResult.failure<void, unknown>(result.cause);
      }
    }
    return AsyncResult.success(undefined);
  };

  const canOrganizeProjectGroup = (_members: ReadonlyArray<ProjectGroupMember>) => true;

  return { updateProjectGroup, canOrganizeProjectGroup };
}

/** Pin state for a project group, shared by every list that can pin or unpin a project. */
export function useProjectPin() {
  const { updateProjectGroup, canOrganizeProjectGroup } = useProjectGroupUpdate();
  type PinnableGroup = {
    readonly memberProjects: ReadonlyArray<ProjectGroupMember>;
    readonly pinned: boolean;
    readonly isScratch?: boolean | undefined;
  };
  const canPinProjectGroup = (group: PinnableGroup) =>
    canOrganizeProjectGroup(group.memberProjects) &&
    !group.memberProjects.some((member) => member.id === "scratch");
  const setProjectGroupPinned = (group: PinnableGroup, pinned: boolean) => {
    void updateProjectGroup(
      group.memberProjects,
      { pinned },
      pinned ? "Failed to pin project" : "Failed to unpin project",
    );
  };
  return {
    canPinProjectGroup,
    setProjectGroupPinned,
    toggleProjectGroupPin: (group: PinnableGroup) => setProjectGroupPinned(group, !group.pinned),
  };
}

export function checkProjectAccess(
  _members: ReadonlyArray<ProjectGroupMember>,
  _failureTitle: string,
): AtomCommandResult<void, unknown> | null {
  return null;
}

export function reportProjectFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

function failWith(title: string, message: string): AtomCommandResult<void, unknown> {
  const result = AsyncResult.failure<void, Error>(Cause.fail(new Error(message)));
  reportProjectFailure(title, result);
  return result;
}
