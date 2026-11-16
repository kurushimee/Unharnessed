// Adapted from T3 Code's ProjectFavicon.tsx: the icon kuru code's main process
// finds in the project's folder (main/favicons.ts), else T3 Code's monogram.
import type { EnvironmentProject } from "~/rt/state/models";
import type { ProjectIconColor } from "~/contracts";
import { FolderCodeIcon } from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { useProjectFaviconUrl } from "../state/assets";
import { deriveProjectIdentity } from "../projectIdentity";
import { projectIconColorClassName } from "../projectIconColors";
import { ProjectMonogram } from "./ProjectMonogram";
import { cn } from "~/lib/utils";

export type ProjectFaviconProject = Pick<EnvironmentProject, "environmentId" | "workspaceRoot" | "title"> & {
  readonly faviconPath?: string | null;
  readonly projectIcon?:
    | { readonly kind: "monogram"; readonly text: string; readonly color: ProjectIconColor }
    | { readonly kind: "emoji"; readonly emoji: string }
    | null;
};
export function ProjectFavicon(input: {
  project: ProjectFaviconProject;
  className?: string | undefined;
  fallbackIcon?: ComponentType<{ className?: string }>;
}) {
  const { project } = input;
  if (project.projectIcon?.kind === "monogram") {
    return (
      <ProjectMonogram
        text={project.projectIcon.text}
        color={project.projectIcon.color}
        className={input.className}
      />
    );
  }
  if (project.projectIcon?.kind === "emoji") {
    return (
      <ProjectFaviconFallback
        className={input.className}
        icon={FolderCodeIcon}
        emoji={project.projectIcon.emoji}
      />
    );
  }
  return <AutomaticProjectFavicon {...input} />;
}

function AutomaticProjectFavicon(input: Parameters<typeof ProjectFavicon>[0]) {
  const { project } = input;
  const src = useProjectFaviconUrl(project.workspaceRoot);
  const FallbackIcon = input.fallbackIcon ?? FolderCodeIcon;

  if (!src) {
    return (
      <ProjectFaviconFallback
        className={input.className}
        icon={FallbackIcon}
        projectName={project.title}
      />
    );
  }

  const cacheKey = JSON.stringify([project.environmentId, project.workspaceRoot]);

  return (
    <ProjectFaviconImage
      key={cacheKey}
      src={src}
      className={input.className}
      fallbackIcon={FallbackIcon}
      fallbackProjectName={project.title}
    />
  );
}

function ProjectFaviconFallback({
  className,
  icon: Icon,
  emoji,
  projectName,
}: {
  readonly className?: string | undefined;
  readonly icon: ComponentType<{ className?: string }>;
  readonly emoji?: string | undefined;
  readonly projectName?: string | undefined;
}) {
  if (projectName && projectName.trim().length > 0) {
    const identity = deriveProjectIdentity(projectName);
    return (
      <ProjectMonogram text={identity.monogram} color={identity.color} className={className} />
    );
  }

  if (emoji) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-3.5 shrink-0 items-center justify-center leading-none [container-type:size]",
          className,
        )}
      >
        <span className="text-[length:80cqh] leading-none">{emoji}</span>
      </span>
    );
  }

  return <Icon className={cn("size-3.5 shrink-0 text-icon-muted", className)} />;
}

function ProjectFaviconImage({
  src,
  className,
  fallbackIcon: FallbackIcon,
  fallbackProjectName,
}: {
  readonly src: string;
  readonly className?: string | undefined;
  readonly fallbackIcon: ComponentType<{ className?: string }>;
  readonly fallbackProjectName?: string | undefined;
}) {
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(() =>
    src.startsWith("data:image/") ? src : null,
  );
  const isLoading = displayedSrc !== src;
  const handleLoadError = (failedSrc: string) => {
    setDisplayedSrc((currentSrc) => (currentSrc === failedSrc ? null : currentSrc));
  };

  return (
    <>
      {displayedSrc === null ? (
        <ProjectFaviconFallback
          className={className}
          icon={FallbackIcon}
          projectName={fallbackProjectName}
        />
      ) : null}
      {displayedSrc ? (
        <img
          src={displayedSrc}
          alt=""
          className={cn("size-3.5 shrink-0 rounded-[25%] object-contain", className)}
          onError={() => handleLoadError(displayedSrc)}
        />
      ) : null}
      {isLoading ? (
        <img
          src={src}
          alt=""
          className="hidden"
          onLoad={() => {
            setDisplayedSrc(src);
          }}
          onError={() => handleLoadError(src)}
        />
      ) : null}
    </>
  );
}
