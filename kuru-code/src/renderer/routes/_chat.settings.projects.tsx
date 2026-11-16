import { createFileRoute } from "@tanstack/react-router";
import { ProjectsSettings } from "../components/settings/ProjectsSettings";

function SettingsProjectsRoute() {
  const { project } = Route.useSearch();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ProjectsSettings projectKey={project} />
    </div>
  );
}

export const Route = createFileRoute("/_chat/settings/projects")({
  validateSearch: (raw: Record<string, unknown>): { project?: string } =>
    typeof raw.project === "string" && raw.project.trim() ? { project: raw.project } : {},
  component: SettingsProjectsRoute,
});
