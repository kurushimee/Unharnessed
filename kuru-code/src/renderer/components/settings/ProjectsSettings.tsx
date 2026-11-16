// Adapted from T3 Code's components/settings/ProjectsSettings.tsx and
// ProjectSettingsPanel.tsx: a project's name, icon, pin, archive and removal. kuru code
// has one machine and no settings scopes, so the page lists the projects to pick one; a
// project is one folder (no checkouts), and project defaults and actions are not part of it.
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, Trash2Icon } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { invoke, post } from "~/bridge";
import { scopeProjectRef } from "~/rt/environment";
import { settlePromise } from "~/rt/state/runtime";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useProjectGroupUpdate, type ProjectGroupUpdate } from "../../hooks/useProjectGroupUpdate";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { readLocalApi } from "../../localApi";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const ProjectIconPickerDialog = lazy(() =>
  import("./ProjectIconPickerDialog").then((module) => ({
    default: module.ProjectIconPickerDialog,
  })),
);

export function ProjectsSettings({ projectKey }: { projectKey: string | undefined }) {
  const groups = useSidebarProjectGroups().filter(
    (group) => !group.memberProjects.some((member) => member.isScratch),
  );
  if (projectKey === undefined) return <ProjectList groups={groups} />;
  const selected = groups.find((group) => group.projectKey === projectKey);
  if (!selected) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        {groups.length === 0
          ? "Add a project from the sidebar to configure it here."
          : "This project is no longer available."}
      </div>
    );
  }
  return <ProjectDetail key={selected.projectKey} group={selected} />;
}

function ProjectList({ groups }: { groups: ReadonlyArray<SidebarProjectSnapshot> }) {
  return (
    <SettingsPageContainer>
      <SettingsSection {...searchableSetting("project-overview")} title="Projects">
        {groups.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
            Add a project from the sidebar to configure it here.
          </p>
        ) : (
          groups.map((group) => (
            <Link
              key={group.projectKey}
              to="/settings/projects"
              search={{ project: group.projectKey }}
              className="block rounded-xl hover:bg-accent/50"
            >
              <SettingsRow
                title={
                  <span className="flex items-center gap-2">
                    <ProjectFavicon project={group.memberProjects[0]!} className="size-4" />
                    {group.displayName}
                  </span>
                }
                description={group.memberProjects[0]!.workspaceRoot}
                control={<ChevronRightIcon className="size-4 text-muted-foreground" />}
              />
            </Link>
          ))
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function ProjectDetail({ group }: { group: SidebarProjectSnapshot }) {
  const navigate = useNavigate();
  const project = group.memberProjects[0]!;
  const { updateProjectGroup } = useProjectGroupUpdate();
  const projectNameEditedRef = useRef(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const faviconPath = project.faviconPath ?? null;
  const projectIcon = project.projectIcon ?? null;
  const folderName = project.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? project.workspaceRoot;

  const update = async (input: ProjectGroupUpdate, failureTitle: string) => {
    setIsSaving(true);
    await updateProjectGroup(group.memberProjects, input, failureTitle);
    setIsSaving(false);
  };

  const renameGroup = async (nextTitle: string, wasEdited: boolean) => {
    const title = nextTitle.trim();
    if (!title) {
      toastManager.add({ type: "warning", title: "Project title cannot be empty" });
      return;
    }
    if (!wasEdited || title === group.displayName) return;
    await update({ title }, "Failed to rename project");
  };

  const chooseFile = async () => {
    const picked = await settlePromise(() =>
      invoke<string | null>("project.pickFavicon", { cwd: project.workspaceRoot }),
    );
    if (picked._tag === "Success" && picked.value) {
      await update({ faviconPath: picked.value, projectIcon: null }, "Failed to update project icon");
    }
  };

  const removeProject = async () => {
    const api = readLocalApi();
    if (!api) return;
    const confirmed = await settlePromise(() =>
      api.dialogs.confirm(
        `Remove "${group.displayName}"?\nIts threads leave the sidebar. Conversations stay in ~/.unharnessed/sessions and files on disk are not touched; adding the folder again brings them back.`,
        { variant: "destructive" },
      ),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return;
    post({ type: "removeProject", id: project.id });
    const draftStore = useComposerDraftStore.getState();
    const projectRef = scopeProjectRef(project.environmentId, project.id);
    const projectDraftThread = draftStore.getDraftThreadByProjectRef(projectRef);
    if (projectDraftThread) draftStore.clearDraftThread(projectDraftThread.draftId);
    draftStore.clearProjectDraftThreadId(projectRef);
    void navigate({ to: "/settings/projects", search: {}, replace: true });
  };

  return (
    <>
      <SettingsPageContainer className="gap-6">
        <SettingsSection {...searchableSetting("project-overview")} title="Project" hideTitle>
          <SettingsRow
            title="Name"
            description="The name for this project in the sidebar and thread lists."
            resetAction={
              group.displayName !== folderName ? (
                <SettingResetButton
                  label="project name"
                  onClick={() => void update({ title: null }, "Failed to rename project")}
                />
              ) : null
            }
            control={
              <Input
                key={`${group.projectKey}:${group.displayName}`}
                size="sm"
                className="w-full sm:w-64"
                aria-label="Project name"
                defaultValue={group.displayName}
                onChange={() => {
                  projectNameEditedRef.current = true;
                }}
                onBlur={(event) => {
                  const wasEdited = projectNameEditedRef.current;
                  projectNameEditedRef.current = false;
                  void renameGroup(event.currentTarget.value, wasEdited);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            }
          />
          <SettingsRow
            title="Project icon"
            description={
              projectIcon?.kind === "lucide"
                ? `${projectIcon.name} · ${projectIcon.color}`
                : projectIcon?.kind === "monogram"
                  ? `${projectIcon.text} · ${projectIcon.color}`
                  : projectIcon?.kind === "emoji"
                    ? projectIcon.emoji
                    : (faviconPath ?? "Automatic")
            }
            resetAction={
              faviconPath !== null || projectIcon !== null ? (
                <SettingResetButton
                  label="project icon"
                  disabled={isSaving}
                  onClick={() =>
                    void update({ faviconPath: null, projectIcon: null }, "Failed to update project icon")
                  }
                />
              ) : null
            }
            control={
              <div className="flex items-center gap-2">
                <ProjectFavicon project={project} className="size-6" />
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  aria-label="Choose a project icon"
                  disabled={isSaving}
                  onClick={() => setIconPickerOpen(true)}
                >
                  Choose icon
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  aria-label="Choose a project icon file"
                  disabled={isSaving}
                  onClick={() => void chooseFile()}
                >
                  Choose file
                </Button>
              </div>
            }
          />
          <SettingsRow
            title="Pin"
            description="Pinned projects come first in project pickers."
            control={
              <Switch
                checked={group.pinned}
                disabled={isSaving}
                onCheckedChange={(checked) =>
                  void update(
                    { pinned: Boolean(checked) },
                    checked ? "Failed to pin project" : "Failed to unpin project",
                  )
                }
                aria-label="Pin project"
              />
            }
          />
          <SettingsRow
            title="Archive"
            description={
              group.archived
                ? "Hidden from project pickers. Threads and files are kept."
                : "Hides the project from project pickers. Threads and files are kept."
            }
            control={
              <Button
                size="sm"
                variant="outline"
                disabled={isSaving}
                onClick={() =>
                  void update(
                    { archived: !group.archived },
                    group.archived ? "Failed to unarchive project" : "Failed to archive project",
                  )
                }
              >
                {group.archived ? "Unarchive" : "Archive"}
              </Button>
            }
          />
        </SettingsSection>
        <SettingsSection title="Folder">
          <SettingsRow
            title="Location"
            description={<span className="font-mono">{project.workspaceRoot}</span>}
          />
        </SettingsSection>
        <SettingsSection title="Danger">
          <SettingsRow
            title="Remove project"
            description="Removes the project and its threads from the sidebar. Conversations and files on disk are not touched."
            control={
              <Button size="sm" variant="destructive-outline" onClick={() => void removeProject()}>
                <Trash2Icon />
                Remove project
              </Button>
            }
          />
        </SettingsSection>
      </SettingsPageContainer>
      {iconPickerOpen ? (
        <Suspense fallback={null}>
          <ProjectIconPickerDialog
            current={projectIcon}
            projectName={project.title}
            open
            onOpenChange={setIconPickerOpen}
            onSelect={(icon) =>
              void update({ faviconPath: null, projectIcon: icon }, "Failed to update project icon")
            }
          />
        </Suspense>
      ) : null}
    </>
  );
}
