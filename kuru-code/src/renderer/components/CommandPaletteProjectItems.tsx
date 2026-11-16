import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import type { Project } from "../types";
import {
  buildProjectActionItems,
  type CommandPaletteItemPin,
  type CommandPaletteProject,
  ITEM_ICON_CLASS,
} from "./CommandPalette.logic";
import { ProjectFavicon } from "./ProjectFavicon";
import { CommandPaletteMetaDot } from "./ThreadCommandSubtitle";

interface ProjectItemsInput {
  readonly projects: ReadonlyArray<CommandPaletteProject>;
  readonly projectGroupByTargetKey: ReadonlyMap<string, SidebarProjectSnapshot>;
  readonly runProject: (project: CommandPaletteProject) => Promise<void>;
  readonly pin?: (project: CommandPaletteProject) => CommandPaletteItemPin | null;
}

function projectFaviconIcon(project: Project) {
  return <ProjectFavicon project={project} className={ITEM_ICON_CLASS} />;
}

/** A project's titles and folders, every member's when it is grouped. */
function projectSearchTerms(input: ProjectItemsInput, project: CommandPaletteProject) {
  const members = input.projectGroupByTargetKey.get(`${project.environmentId}:${project.id}`)
    ?.memberProjects ?? [project];
  return members.flatMap((member) => [member.title, member.workspaceRoot]);
}

/** Projects as root search results; a grouped project matches on every member. */
export function buildProjectSearchItems(input: ProjectItemsInput) {
  return buildProjectActionItems({
    projects: input.projects,
    valuePrefix: "project",
    searchTerms: (project) => projectSearchTerms(input, project),
    renderDescription: (project) => <ProjectLocationDescription workspaceRoot={project.workspaceRoot} />,
    icon: projectFaviconIcon,
    runProject: input.runProject,
    ...(input.pin ? { pin: input.pin } : {}),
  });
}

/** Projects as targets of the "New thread in..." submenu. */
export function buildNewThreadInProjectItems(
  input: ProjectItemsInput & { readonly currentProjectKey: string | null },
) {
  return buildProjectActionItems({
    projects: input.projects,
    valuePrefix: "new-thread-in",
    searchTerms: (project) => projectSearchTerms(input, project),
    renderDescription: (project) => (
      <ProjectLocationDescription
        workspaceRoot={project.workspaceRoot}
        current={input.currentProjectKey === `${project.environmentId}:${project.id}`}
      />
    ),
    icon: projectFaviconIcon,
    runProject: input.runProject,
    ...(input.pin ? { pin: input.pin } : {}),
  });
}

function ProjectLocationDescription(props: { readonly workspaceRoot: string; readonly current?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      {props.current ? (
        <>
          <span className="shrink-0">Current</span>
          <CommandPaletteMetaDot />
        </>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{props.workspaceRoot}</span>
    </span>
  );
}
