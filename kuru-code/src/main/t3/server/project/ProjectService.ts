import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ProjectId, type OrchestrationProjectShell } from "~/contracts";

import type { Project } from "@shared/protocol";

/**
 * The project reads T3 Code's pull request service makes. kuru code's projects are the folders
 * its store keeps (`threads.app.projects`), so they are read from there rather than from T3
 * Code's project store; a project whose folder is gone has no checkout to read.
 */
export class ProjectService extends Context.Service<
  ProjectService,
  {
    readonly getShell: (projectId: ProjectId) => Effect.Effect<Option.Option<OrchestrationProjectShell>>;
    readonly listShells: (options?: {
      readonly projectIds?: ReadonlyArray<ProjectId>;
    }) => Effect.Effect<ReadonlyArray<OrchestrationProjectShell>>;
  }
>()("t3/project/ProjectService") {}

const iso = (ms: number | undefined) =>
  ms === undefined || !Number.isFinite(ms) ? null : new Date(ms).toISOString();

function toShell(project: Project): OrchestrationProjectShell {
  const at = new Date(0).toISOString();
  return {
    id: ProjectId.make(project.id),
    title: project.name,
    workspaceRoot: project.path,
    defaultModelSelection: null,
    scripts: [],
    pinnedAt: iso(project.pinnedAt),
    archivedAt: iso(project.archivedAt),
    createdAt: at,
    updatedAt: at,
  };
}

/** `projects` reads the store's current projects. */
export const layer = (projects: () => ReadonlyArray<Project>) =>
  Layer.succeed(ProjectService)({
    getShell: (projectId) =>
      Effect.sync(() =>
        Option.fromNullishOr(projects().find((project) => !project.missing && project.id === projectId)).pipe(
          Option.map(toShell),
        ),
      ),
    listShells: (options) =>
      Effect.sync(() =>
        projects()
          .filter(
            (project) =>
              !project.missing &&
              (options?.projectIds === undefined || options.projectIds.includes(ProjectId.make(project.id))),
          )
          .map(toShell),
      ),
  });
