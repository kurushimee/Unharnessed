// From T3 Code's lib/openPullRequestLink.ts. T3 Code opened a pull request in the thread's
// right panel and a commit in its diff panel; kuru code has neither, so a pull request link
// opens on the Pull requests page and every other link in the browser.
import { parsePullRequestAnchor } from "~/shared/pullRequestAnchor";
import type { EnvironmentId, ScopedThreadRef } from "~/contracts";
import { useNavigate } from "@tanstack/react-router";
import { type MouseEvent } from "react";

import {
  resolveChangeRequestLinkTarget,
  resolvePullRequestPreviewTarget,
} from "~/rt/changeRequestLinks";

import { useOpenLink } from "../browser/useOpenLink";
import { useClientSettings } from "../hooks/useSettings";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { readProjects, useProjects } from "../state/entities";
import { readPrimaryEnvironmentId } from "../state/environments";

export function usePullRequestPreviewTarget(environmentId: EnvironmentId | null, url: string) {
  const projects = useProjects();
  return resolvePullRequestPreviewTarget({
    environmentId,
    projects,
    pullRequestsEnabled: true,
    url,
  });
}

function shouldOpenPullRequestExternally(
  event: Pick<MouseEvent<HTMLElement>, "metaKey" | "ctrlKey"> &
    Partial<Pick<MouseEvent<HTMLElement>, "button">>,
): boolean {
  return event.metaKey || event.ctrlKey || event.button === 1;
}

export function useOpenChangeRequestLink(
  threadRef?: ScopedThreadRef,
): (
  event: Pick<
    MouseEvent<HTMLElement>,
    "preventDefault" | "stopPropagation" | "metaKey" | "ctrlKey"
  > &
    Partial<Pick<MouseEvent<HTMLElement>, "button" | "shiftKey" | "altKey">>,
  targetUrl: string,
  targetThreadRef?: ScopedThreadRef,
  targetEnvironmentId?: EnvironmentId,
) => boolean {
  const navigate = useNavigate();
  const openInApp = useClientSettings((settings) => settings.pullRequestLinksOpenInApp);
  return (event, targetUrl, targetThreadRef, targetEnvironmentId) => {
    if (!openInApp || shouldOpenPullRequestExternally(event)) return false;
    const resolvedThreadRef = targetThreadRef ?? threadRef;
    const target = resolveChangeRequestLinkTarget({
      url: targetUrl,
      projects: readProjects(),
      configLoaded: () => true,
      environmentId: resolvedThreadRef?.environmentId ?? targetEnvironmentId,
      primaryEnvironmentId: readPrimaryEnvironmentId(),
      lendHostProject: false,
    });
    if (target === null) return false;
    const { project, repository, number, host } = target;
    const revealUrl = parsePullRequestAnchor(targetUrl) === null ? undefined : targetUrl;
    event.preventDefault();
    event.stopPropagation();
    void navigate({
      to: "/pull-requests",
      search: {
        involvement: "all",
        state: "all",
        repository,
        number,
        ...(host === undefined ? {} : { selectedHost: host }),
        selectedProjectId: project.id,
        selectedEnvironmentId: project.environmentId,
        ...(revealUrl === undefined ? {} : { selectedUrl: revealUrl }),
      },
    });
    return true;
  };
}

export function useOpenPrLink(threadRef?: ScopedThreadRef) {
  const openChangeRequest = useOpenChangeRequestLink(threadRef);
  const openLink = useOpenLink(threadRef);
  return (event: MouseEvent<HTMLElement>, prUrl: string, targetThreadRef?: ScopedThreadRef) => {
    if (event.button > 1) return false;
    event.stopPropagation();
    const openInBrowser = shouldOpenPullRequestExternally(event);
    const isAnchor =
      event.currentTarget instanceof HTMLAnchorElement && event.currentTarget.href.length > 0;
    // Native links handle modified clicks; buttons still need openExternal.
    if (openInBrowser && isAnchor) return false;

    event.preventDefault();
    if (!openInBrowser && openChangeRequest(event, prUrl, targetThreadRef)) return true;

    void openLink(prUrl, { event, threadRef: targetThreadRef }).catch((error: unknown) => {
      console.error(error);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open pull request link",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
    return false;
  };
}
