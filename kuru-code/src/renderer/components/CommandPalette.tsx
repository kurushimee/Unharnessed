import { ThreadContextDragGhost } from "./chat/ThreadContextDragGhost";

import { scopedThreadKey, scopeProjectRef, scopeThreadRef } from "~/rt/environment/index";
import { sourceControlClients } from "~/rt/sourceControlClients";
import { resolveThreadReferenceCopyTarget } from "~/rt/threadReference";
import {
  createBrowseNavigationCoordinator,
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
  getFilesystemBrowseTabCompletion,
} from "~/rt/state/filesystem";
import { settlePromise, squashAtomCommandFailure } from "~/rt/state/runtime";
import { type FilesystemBrowseResult, ProjectId } from "~/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ChartNoAxesColumnIcon,
  CornerLeftUpIcon,
  FolderIcon,
  FolderPlusIcon,
  MessageSquareDashedIcon,
  LinkIcon,
  MessageSquareIcon,
  PaletteIcon,
  SettingsIcon,
  MonitorIcon,
  PinIcon,
  PinOffIcon,
  SquarePenIcon,
  TextSearchIcon,
} from "lucide-react";
import { openThreadFind } from "./chat/threadFindStore";
import {
  useDeferredValue,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { LegendListRef } from "@legendapp/list/react";

import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useOpenPanelPullRequestUrl } from "../hooks/useOpenPanelPullRequestUrl";
import { copyThreadReference } from "../lib/copyThreadReference";
import { queueWorkspaceFocusFromPalette, restoreWorkspaceFocusFromPalette } from "../lib/workspaceFocus";
import { useClientSettings } from "../hooks/useSettings";
import { useStableCallback } from "../hooks/useStableCallback";
import { filesystemEnvironment } from "../state/filesystem";
import { useEnvironmentQuery } from "../state/query";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { useScratchProject } from "../hooks/useScratchProject";
import { invoke } from "~/bridge";
import { useOrderWhileOpen } from "../hooks/useOrderWhileOpen";
import { useProjectGroupUpdate, useProjectPin } from "../hooks/useProjectGroupUpdate";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import {
  useAnyEnvironmentHiding,
  useHiddenThreadKeys,
  useEnvironmentThreadRefs,
  useProjects,
  useVisibleThreadShells,
  waitForProject,
} from "../state/entities";
import { visibleLinkedThreads } from "~/rt/state/threads";
import { resolveThreadActionProjectRef, startNewThreadFromContext } from "../lib/chatThreadActions";
import {
  appendBrowsePathSegment,
  findProjectByPath,
  getBrowseDirectoryPath,
  hasTrailingPathSeparator,
  isExplicitRelativeProjectPath,
  isFilesystemBrowseQuery,
  isScratchProject,
  resolveProjectPathForDispatch,
} from "~/rt/state/projects";
import { resolvePastedPath } from "~/shared/path";
import {
  dispatchCommandPalette,
  getCommandPaletteReturnFocus,
  useCommandPaletteMount,
  useCommandPaletteStore,
} from "../commandPaletteStore";
import { PULL_REQUESTS_PANEL_REF } from "../rightPanelStore";
import { getLatestThreadForProject, sortThreads } from "~/rt/state/threadSort";
import { getLocalFileManagerName, isMacPlatform } from "../lib/utils";
import { buildThreadRouteParams } from "../threadRoutes";
import {
  resolveCommandPaletteProject,
  ADDON_ICON_CLASS,
  browseInputEndPaddingClass,
  buildBrowseGroups,
  buildRootGroups,
  buildLinkedThreadActionItems,
  buildCommandPaletteRows,
  enumerateCommandPaletteItems,
  newThreadNoProjectIndex,
  findHighlightedCommandPaletteItem,
  type CommandPaletteActionItem,
  type CommandPaletteOpenIntent,
  type CommandPaletteProject,
  type CommandPaletteSubmenuItem,
  type CommandPaletteView,
  filterCommandPaletteGroups,
  buildNestedSearchItems,
  getCommandPaletteInputPlaceholder,
  getCommandPaletteMode,
  ITEM_ICON_CLASS,
  RECENT_THREAD_LIMIT,
  createCommandPaletteSearchState,
  errorMessage,
  getEnvironmentBrowsePlatform,
  reduceCommandPaletteSearchState,
} from "./CommandPalette.logic";
import { isSidebarHiddenThread } from "./Sidebar.logic";
import { CommandPaletteContent, type PendingInputSelection } from "./CommandPaletteContent";
import {
  selectCommandPaletteClientSettings,
  useProjectLookups,
  useSortedProjectGroups,
} from "./CommandPaletteLookups";
import { buildNewThreadInProjectItems, buildProjectSearchItems } from "./CommandPaletteProjectItems";
import { CommandPaletteSubmitButton } from "./CommandPaletteAddProject";
import { useCommandPaletteThreadItems } from "./CommandPaletteThreadItems";
import { useCommandPaletteThemeItems } from "./CommandPaletteThemeItems";
import { CommandPaletteVirtualizedResults, scrollCommandPaletteRowIntoView } from "./CommandPaletteResults";
import {
  settingsForThisPlatform,
  SETTINGS_SEARCH_ITEMS,
  SETTINGS_SECTION_LABELS,
} from "./settings/settingsSearch";
import { usePrimaryServerKeybindings } from "../state/server";
import { resolveShortcutCommand, threadJumpIndexFromCommand } from "../keybindings";
import { CommandDialog, CommandDialogPopup, CommandFooterAction } from "./ui/command";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { ComposerHandleContext, useComposerHandleContext } from "../composerHandleContext";
import type { ChatComposerHandle } from "./chat/ChatComposer";
import { pickableProjectGroups } from "~/rt/state/projectGrouping";
import { buildSidebarProjectPickerEntries } from "../sidebarProjectGrouping";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "~/components/pullRequest/pullRequestListPreferences";
import { threadRecentUse } from "~/shared/paletteSearch";

const EMPTY_BROWSE_ENTRIES: FilesystemBrowseResult["entries"] = [];
const NEW_THREAD_IN_GROUP = "projects";

/** Adding a project starts browsing at the home folder. */
const ADD_PROJECT_BROWSE_QUERY = "~/";

/** The submenu an open intent starts in; its groups resolve while rendering. */
function openIntentView(intent: CommandPaletteOpenIntent | null): CommandPaletteView | null {
  switch (intent?.kind) {
    case "add-project":
      return {
        addonIcon: <FolderPlusIcon className={ADDON_ICON_CLASS} />,
        groups: [],
        initialQuery: ADD_PROJECT_BROWSE_QUERY,
      };
    case "new-thread-in":
      return {
        addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
        groups: [{ value: NEW_THREAD_IN_GROUP, label: "Projects", items: [] }],
      };
    case "change-theme":
      return {
        addonIcon: <PaletteIcon className={ADDON_ICON_CLASS} />,
        groups: [{ value: "themes", label: "Change theme", items: [] }],
      };
    case "search":
    case undefined:
      return null;
  }
}

const NEW_THREAD_NO_PROJECT_VALUE = "new-thread-in:no-project";

export function CommandPalette({ children }: { children: ReactNode }) {
  useCommandPaletteMount();
  const state = useCommandPaletteStore();
  const setOpen = (open: boolean) => dispatchCommandPalette({ _tag: "SetOpen", open });
  const composerHandleRef = useRef<ChatComposerHandle | null>(null);

  return (
    <ComposerHandleContext value={composerHandleRef}>
      <ThreadContextDragGhost />
      <CommandDialog
        open={state.open}
        onOpenChange={setOpen}
      >
        <div className="contents" inert={state.open}>
          {children}
        </div>
        <CommandPaletteDialog
          session={state.session}
          openIntent={state.openIntent}
          setOpen={setOpen}
        />
      </CommandDialog>
    </ComposerHandleContext>
  );
}

function CommandPaletteDialog(props: {
  readonly session: number;
  readonly openIntent: CommandPaletteOpenIntent | null;
  readonly setOpen: (open: boolean) => void;
}) {
  const composerHandleRef = useComposerHandleContext();

  return (
    <CommandDialogPopup
      aria-label="Command palette"
      className="overflow-hidden"
      data-command-palette="true"
      data-testid="command-palette"
      finalFocus={() => {
        if (restoreWorkspaceFocusFromPalette()) return false;
        const returnFocus = getCommandPaletteReturnFocus();
        if (returnFocus === false) return false;
        const composer = composerHandleRef?.current;
        // Behind the Settings modal the composer is inert and cannot take focus.
        if (!composer || document.querySelector("[data-app-modal]")) return returnFocus;
        composer.focusAtEnd();
        return false;
      }}
      onBackdropPointerDown={() => {
        props.setOpen(false);
      }}
    >
      <OpenCommandPaletteDialog
        key={props.session}
        openIntent={props.openIntent}
        setOpen={props.setOpen}
      />
    </CommandDialogPopup>
  );
}

function OpenCommandPaletteDialog(props: {
  readonly openIntent: CommandPaletteOpenIntent | null;
  readonly setOpen: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { setOpen } = props;
  // Keyed by palette session: the intent only seeds this mount, and closing
  // must not change what the closing palette shows.
  const [initialSearch] = useState(() => ({
    query: props.openIntent?.kind === "search" ? props.openIntent.query : "",
    linkedThreadSearch: props.openIntent?.kind === "search" ? props.openIntent : null,
  }));
  const linkedThreadSearch = initialSearch.linkedThreadSearch;
  // Rows were captured when the palette opened; drop any hidden since then.
  const hiddenKeys = useHiddenThreadKeys();
  const linkedEnvironmentId = linkedThreadSearch?.linkedThreads?.environmentId ?? null;
  const hidingAnywhere = useAnyEnvironmentHiding();
  const linkedThreadRefs = useEnvironmentThreadRefs(linkedEnvironmentId);
  const [searchState, dispatchSearch] = useReducer(reduceCommandPaletteSearchState, null, () => {
    const view = openIntentView(props.openIntent);
    return view
      ? { query: view.initialQuery ?? "", views: [{ view, parentQuery: "" }] }
      : createCommandPaletteSearchState(initialSearch.query);
  });
  const { query, views: viewStack } = searchState;
  const setQuery = (query: string) => dispatchSearch({ type: "query", query });
  const deferredQuery = useDeferredValue(query);
  const isActionsOnly = deferredQuery.startsWith(">");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const resultListRef = useRef<LegendListRef | null>(null);
  // A pushed view drops the typed highlight until the user moves it again.
  const highlightClearedRef = useRef(viewStack.length > 0);
  // Entering or leaving browse mode remounts the input; carry the caret across it.
  const remountSelectionRef = useRef<PendingInputSelection | null>(null);
  function clearTypedHighlight(): void {
    highlightClearedRef.current = true;
    setHighlightedItemValue(null);
  }
  const clientSettings = useClientSettings(selectCommandPaletteClientSettings);
  const { updateProjectGroup } = useProjectGroupUpdate();
  const { scratchEnvironmentId, scratchWorkspaceRootFor, startScratchThread } = useScratchProject();
  const loadBrowsePath = useAtomQueryRunner(filesystemEnvironment.browse, {
    reportFailure: false,
    reportDefect: false,
  });
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const projects = useProjects();
  const referenceThreadRef =
    pathname === "/pull-requests"
      ? PULL_REQUESTS_PANEL_REF
      : activeThread
        ? scopeThreadRef(activeThread.environmentId, activeThread.id)
        : null;
  const openPanelPullRequestUrl = useOpenPanelPullRequestUrl(referenceThreadRef);
  const activeThreadReferenceCopyTarget =
    referenceThreadRef === null || (pathname === "/pull-requests" && !openPanelPullRequestUrl)
      ? null
      : resolveThreadReferenceCopyTarget({
          threadRef: referenceThreadRef,
          title: activeThread?.title ?? "",
          openPanelPullRequestUrl,
          pullRequests: activeThread?.pullRequests,
          linkedPullRequestUrl:
            activeThread?.linkedPullRequest?.url ?? activeThread?.branchPullRequest?.url ?? null,
        });
  const copyActiveThreadReference = async () => {
    if (activeThreadReferenceCopyTarget === null) return;
    await copyThreadReference(activeThreadReferenceCopyTarget);
  };
  // Side chats and subagents open inside their parent, so opening a project never lands on one.
  const threads = useVisibleThreadShells().filter((thread) => !isSidebarHiddenThread(thread));
  const keybindings = usePrimaryServerKeybindings();
  const { changeThemeItem, changeAppearanceItem, themeEditorItem } = useCommandPaletteThemeItems();
  const currentView = viewStack.at(-1)?.view ?? null;
  const threadSearchQuery = currentView === null && !isActionsOnly ? deferredQuery : "";
  const [browseGeneration, setBrowseGeneration] = useState(0);
  const [browseNavigation] = useState(createBrowseNavigationCoordinator);
  const [isPickingProjectFolder, setIsPickingProjectFolder] = useState(false);
  const projectGroups = useSortedProjectGroups();
  const contextualProjectRef = resolveThreadActionProjectRef({
    activeDraftThread,
    activeThread: activeThread ?? undefined,
    defaultProjectRef,
    handleNewThread,
  });
  const projectPickerEntries = buildSidebarProjectPickerEntries({
    groups: pickableProjectGroups(projectGroups),
    preferredProjectRef: contextualProjectRef,
  });
  const pickerProjects = projectPickerEntries.map(({ group, targetProject }) => ({
    ...targetProject,
    displayName: group.displayName,
  }));
  const projectGroupByTargetKey = new Map(
    projectPickerEntries.map(({ group, targetProject }) => [
      `${targetProject.environmentId}:${targetProject.id}`,
      group,
    ]),
  );
  const { canPinProjectGroup, toggleProjectGroupPin } = useProjectPin();
  // A row's target record can change when another machine's copy loads, so the kept
  // order follows the project group instead.
  const rowOrderKey = (prefix: string) => (item: CommandPaletteActionItem) =>
    projectGroupByTargetKey.get(item.value.slice(prefix.length + 1))?.projectKey ?? item.value;
  const projectPin = (project: CommandPaletteProject) => {
    const group = projectGroupByTargetKey.get(`${project.environmentId}:${project.id}`);
    return group && canPinProjectGroup(group)
      ? {
          name: group.displayName,
          pinned: group.pinned,
          toggle: () => toggleProjectGroupPin(group),
        }
      : null;
  };

  // kuru code adds projects on its one machine.
  const browseEnvironmentId = primaryEnvironmentId;
  const browseEnvironment =
    environments.find((environment) => environment.environmentId === browseEnvironmentId) ?? null;
  const browseEnvironmentPlatform = getEnvironmentBrowsePlatform(
    browseEnvironment?.serverConfig?.environment.platform.os,
  );
  const browsePath = getFilesystemBrowsePath(query, browseEnvironmentPlatform, true);
  const isBrowsing = browsePath.isBrowsing;
  const browseDirectoryPath = browsePath.directoryPath;
  const paletteMode = getCommandPaletteMode({ currentView, isBrowsing });

  const { projectByKey } = useProjectLookups();

  const activeThreadKey = activeThread
    ? scopedThreadKey(scopeThreadRef(activeThread.environmentId, activeThread.id))
    : null;
  const currentProjectEnvironmentId =
    activeThread?.environmentId ?? activeDraftThread?.environmentId ?? null;
  const currentProjectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? null;
  const scratchTargetEnvironmentId = scratchEnvironmentId(currentProjectEnvironmentId);
  const currentProject = resolveCommandPaletteProject(
    projectByKey,
    currentProjectEnvironmentId,
    currentProjectId,
  );
  const currentProjectCwd = currentProject?.workspaceRoot ?? null;
  const relativePathNeedsActiveProject =
    isExplicitRelativeProjectPath(query.trim()) && currentProjectCwd === null;
  const hasBrowseTarget =
    isBrowsing && browsePath.directoryPath.length > 0 && !relativePathNeedsActiveProject;
  const browseQuery = useEnvironmentQuery(
    hasBrowseTarget
      ? filesystemEnvironment.browse({
          environmentId: browseEnvironmentId,
          input: {
            partialPath: browsePath.directoryPath,
            ...(currentProjectCwd ? { cwd: currentProjectCwd } : {}),
          },
        })
      : null,
  );
  const browseResult = browseQuery.data;
  const isBrowsePending = hasBrowseTarget && browseQuery.isPending;
  const browseEntries = browseResult?.entries ?? EMPTY_BROWSE_ENTRIES;
  const { visibleEntries: visibleBrowseEntries, exactEntry: exactBrowseEntry } =
    filterFilesystemBrowseEntries(browseEntries, browsePath.filterQuery);

  const prefetchBrowsePath = async (partialPath: string): Promise<void> => {
    await loadBrowsePath({
      environmentId: browseEnvironmentId,
      input: {
        partialPath,
        ...(currentProjectCwd ? { cwd: currentProjectCwd } : {}),
      },
    });
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- invalidates the browse navigation coordinator when the palette session unmounts
  useEffect(() => () => browseNavigation.invalidate(), [browseNavigation]);

  const openProjectFromSearch = async (project: (typeof projects)[number]) => {
    const group = projectGroupByTargetKey.get(`${project.environmentId}:${project.id}`);
    const groupedProjectKeys = group
      ? new Set(
          group.memberProjectRefs.map(
            (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
          ),
        )
      : null;
    const latestThread = groupedProjectKeys
      ? (sortThreads(
          threads.filter(
            (thread) =>
              thread.archivedAt === null &&
              groupedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`),
          ),
          clientSettings.sidebarThreadSortOrder,
        )[0] ?? null)
      : getLatestThreadForProject(
          threads.filter((thread) => thread.environmentId === project.environmentId),
          project.id,
          clientSettings.sidebarThreadSortOrder,
        );
    if (latestThread) {
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(latestThread.environmentId, latestThread.id)),
      });
      return;
    }

    await handleNewThread(scopeProjectRef(project.environmentId, project.id));
  };

  // Pinning from a row keeps rows in place while the palette is open.
  const projectSearchItems = useOrderWhileOpen(
    buildProjectSearchItems({
      projects: pickerProjects,
      projectGroupByTargetKey,
      runProject: openProjectFromSearch,
      pin: projectPin,
    }),
    rowOrderKey("project"),
    true,
  );

  const openingOrderThreadItems = useOrderWhileOpen(
    (() => {
      const isScratch = (project: CommandPaletteProject) =>
        isScratchProject(project, scratchWorkspaceRootFor(project.environmentId));
      const currentEntry =
        currentProjectId === null
          ? undefined
          : projectPickerEntries.find((entry) => entry.isPreferred);
      const projectItems = buildNewThreadInProjectItems({
        projects: pickerProjects.filter((project) => !isScratch(project)),
        currentProjectKey: currentEntry
          ? `${currentEntry.targetProject.environmentId}:${currentEntry.targetProject.id}`
          : null,
        projectGroupByTargetKey,
        pin: projectPin,
        runProject: async (project) => {
          const group = projectGroupByTargetKey.get(`${project.environmentId}:${project.id}`);
          const contextualRefBelongsToGroup =
            contextualProjectRef !== null &&
            group?.memberProjectRefs.some(
              (projectRef) =>
                projectRef.environmentId === contextualProjectRef.environmentId &&
                projectRef.projectId === contextualProjectRef.projectId,
            );
          await handleNewThread(
            contextualRefBelongsToGroup
              ? contextualProjectRef
              : scopeProjectRef(project.environmentId, project.id),
          );
        },
      });
      if (scratchTargetEnvironmentId === null) return projectItems;

      const noProjectIndex = newThreadNoProjectIndex(
        projectPickerEntries.map(({ group, targetProject, isPreferred }) => ({
          isScratch: isScratchProject(
            targetProject,
            scratchWorkspaceRootFor(targetProject.environmentId),
          ),
          pinned: group.pinned,
          isPreferred,
        })),
      );
      return [
        ...projectItems.slice(0, noProjectIndex),
        {
          kind: "action" as const,
          value: NEW_THREAD_NO_PROJECT_VALUE,
          searchTerms: ["no project", "without project", "none"],
          title: "No project",
          icon: <MessageSquareDashedIcon className={ITEM_ICON_CLASS} />,
          shortcutCommand: "chat.newWithoutProject" as const,
          run: () => startScratchThread(scratchTargetEnvironmentId),
        },
        ...projectItems.slice(noProjectIndex),
      ];
    })(),
    rowOrderKey("new-thread-in"),
    true,
  );
  // Jump shortcuts follow the rows as shown, so a pin cannot move a number to another row.
  const projectJumpItems = new Map(
    enumerateCommandPaletteItems(
      openingOrderThreadItems.filter((item) => item.value !== NEW_THREAD_NO_PROJECT_VALUE),
    ).map((item) => [item.value, item] as const),
  );
  const projectThreadItems = openingOrderThreadItems.map(
    (item) => projectJumpItems.get(item.value) ?? item,
  );

  const {
    threadItems: allThreadItems,
    threadMessageItems,
    now: searchNow,
    isSearchPending: isThreadSearchPending,
  } = useCommandPaletteThreadItems({ activeThread: activeThread ?? null, threadSearchQuery });
  // Recent means used recently: written in or opened, whichever is later. The
  // open thread would always lead that list, so it is left out.
  const activeThreadValue = activeThread
    ? `thread:${activeThread.environmentId}:${activeThread.id}`
    : null;
  const recentThreadItems = allThreadItems
    .filter((item) => item.value !== activeThreadValue)
    .toSorted(
      (left, right) =>
        (right.threadSearch ? threadRecentUse(right.threadSearch) : 0) -
        (left.threadSearch ? threadRecentUse(left.threadSearch) : 0),
    )
    .slice(0, RECENT_THREAD_LIMIT);

  const pushPaletteView = useStableCallback((view: CommandPaletteView): void => {
    browseNavigation.invalidate();
    dispatchSearch({ type: "push", view });
    highlightClearedRef.current = true;
    setHighlightedItemValue(null);
  });

  function popView(): void {
    browseNavigation.invalidate();
    dispatchSearch({ type: "back" });
    setHighlightedItemValue(null);
  }

  function handleQueryChange(nextQuery: string, source: EventTarget | null): void {
    browseNavigation.invalidate();
    clearTypedHighlight();
    const resolvedQuery = resolvePastedPath(query, nextQuery);
    // A rewritten paste has no matching offsets, so its caret lands at the end.
    if (
      source instanceof HTMLInputElement &&
      resolvedQuery === nextQuery &&
      isFilesystemBrowseQuery(resolvedQuery, browseEnvironmentPlatform) !==
        isBrowsing
    ) {
      remountSelectionRef.current = {
        value: resolvedQuery,
        start: source.selectionStart,
        end: source.selectionEnd,
        direction: source.selectionDirection,
      };
    }
    setQuery(resolvedQuery);
    if (nextQuery === "" && currentView?.initialQuery) {
      popView();
    }
  }

  const startAddProjectBrowse = async (): Promise<void> => {
    const initialBrowsePath = getBrowseDirectoryPath(ADD_PROJECT_BROWSE_QUERY);
    const view: CommandPaletteView = {
      addonIcon: <FolderPlusIcon className={ADDON_ICON_CLASS} />,
      groups: [],
      initialQuery: ADD_PROJECT_BROWSE_QUERY,
    };

    await browseNavigation.run(
      () =>
        initialBrowsePath.length > 0 ? prefetchBrowsePath(initialBrowsePath) : Promise.resolve(),
      () => pushPaletteView(view),
    );
  };

  const actionItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [];

  if (projects.length > 0) {
    const activeProjectTitle =
      projectPickerEntries.find((entry) => entry.isPreferred)?.group.displayName ??
      currentProject?.title ??
      null;

    if (activeProjectTitle) {
      actionItems.push({
        kind: "action",
        value: "action:new-thread",
        searchTerms: ["new thread", "chat", "create", "draft"],
        title: (
          <>
            New thread in <span className="font-semibold">{activeProjectTitle}</span>
          </>
        ),
        searchTitle: `New thread in ${activeProjectTitle}`,
        icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
        shortcutCommand: "chat.newLocal",
        run: async () => {
          await startNewThreadFromContext({
            activeDraftThread,
            activeThread: activeThread ?? undefined,
            defaultProjectRef,
            handleNewThread,
          });
        },
      });
    }

    actionItems.push({
      kind: "submenu",
      value: "action:new-thread-in",
      searchTerms: ["new thread", "project", "pick", "choose", "select"],
      title: "New thread in...",
      icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
      addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
      groups: [{ value: NEW_THREAD_IN_GROUP, label: "Projects", items: projectThreadItems }],
    });
  }

  if (scratchTargetEnvironmentId !== null) {
    actionItems.push({
      kind: "action",
      value: "action:new-thread-without-project",
      searchTerms: ["new thread", "no project", "without project", "none", "chat"],
      title: "New thread without a project",
      icon: <MessageSquareDashedIcon className={ITEM_ICON_CLASS} />,
      shortcutCommand: "chat.newWithoutProject",
      run: () => startScratchThread(scratchTargetEnvironmentId),
    });
  }

  if (activeThreadKey !== null) {
    actionItems.push({
      kind: "action",
      value: "find-current-thread",
      title: "Find in current thread",
      searchTerms: ["find", "search", "messages", "plans"],
      icon: <TextSearchIcon className={ITEM_ICON_CLASS} />,
      shortcutCommand: "chat.find",
      run: async () => {
        openThreadFind(activeThreadKey);
      },
    });
  }

  if (activeThreadReferenceCopyTarget !== null) {
    actionItems.push({
      kind: "action",
      value: "action:copy-thread-reference",
      searchTerms:
        activeThreadReferenceCopyTarget.kind === "pull-request"
          ? ["copy", "pull request", "link", "reference"]
          : ["copy", "thread", "thread id", "reference"],
      title:
        activeThreadReferenceCopyTarget.kind === "pull-request" ? "Copy PR link" : "Copy thread",
      description: activeThreadReferenceCopyTarget.description,
      icon: <LinkIcon className={ITEM_ICON_CLASS} />,
      shortcutCommand: "thread.copyReference",
      run: copyActiveThreadReference,
    });
  }

  const addProjectAction: CommandPaletteActionItem = {
    kind: "action",
    value: "action:add-project",
    searchTerms: ["add project", "folder", "directory", "browse", "open"],
    title: "Add project",
    icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
    keepOpen: true,
    run: startAddProjectBrowse,
  };
  actionItems.push(addProjectAction);

  actionItems.push(changeThemeItem);
  actionItems.push(changeAppearanceItem);

  actionItems.push(themeEditorItem);

  actionItems.push({
      kind: "action",
      value: "action:pull-requests",
      searchTerms: [
        ...new Set(
          sourceControlClients.definitions.flatMap((definition) => {
            const shortLabel = definition.changeRequest.shortLabel.toLowerCase();
            return [
              definition.changeRequest.plural,
              `${shortLabel}s`,
              shortLabel,
              ...definition.label.toLowerCase().split(/[^a-z0-9]+/u),
            ].filter(Boolean);
          }),
        ),
        "review",
        "merge",
        "branch",
      ],
      title: "Open pull requests",
      icon: <PullRequestGlyph.pullRequest className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/pull-requests", search: readPullRequestListPreferences() });
      },
    });

  actionItems.push({
    kind: "action",
    value: "action:usage",
    searchTerms: ["usage", "use", "tokens", "cost", "spend", "limits", "stats", "analytics"],
    title: "Open usage",
    icon: <ChartNoAxesColumnIcon className={ITEM_ICON_CLASS} />,
    shortcutCommand: "usage.open",
    run: async () => {
      await navigate({ to: "/usage" });
    },
  });

  for (const direction of [1, -1] as const) {
    const title = direction === 1 ? "Focus Next Workspace Area" : "Focus Previous Workspace Area";
    actionItems.push({
      kind: "action",
      value: `action:workspace-focus:${direction}`,
      title,
      searchTerms: [title, "accessibility", "navigation", "focus", "F6"],
      icon: <MonitorIcon className={ITEM_ICON_CLASS} />,
      shortcutCommand: direction === 1 ? "workspace.focusNext" : "workspace.focusPrevious",
      run: async () => {
        queueWorkspaceFocusFromPalette(direction);
      },
    });
  }

  actionItems.push({
    kind: "action",
    value: "action:settings",
    searchTerms: ["settings", "preferences", "configuration", "keybindings"],
    title: "Open settings",
    icon: <SettingsIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/settings" });
    },
  });

  // Every group, so an archived project's thread still opens its own settings.
  const currentProjectGroup =
    (contextualProjectRef
      ? projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (ref) =>
              ref.environmentId === contextualProjectRef.environmentId &&
              ref.projectId === contextualProjectRef.projectId,
          ),
        )
      : null) ?? null;
  if (currentProjectGroup && canPinProjectGroup(currentProjectGroup)) {
    actionItems.push({
      kind: "action",
      value: "action:project-pin",
      searchTerms: ["pin", "unpin", "project", "favorite"],
      title: currentProjectGroup.pinned ? "Unpin project" : "Pin project",
      description: currentProjectGroup.displayName,
      icon: currentProjectGroup.pinned ? (
        <PinOffIcon className={ITEM_ICON_CLASS} />
      ) : (
        <PinIcon className={ITEM_ICON_CLASS} />
      ),
      run: async () => toggleProjectGroupPin(currentProjectGroup),
    });
  }
  const contextualProjectGroup = currentProjectGroup ?? projectGroups[0] ?? null;
  if (contextualProjectGroup) {
    actionItems.push({
      kind: "action",
      value: "action:project-settings",
      searchTerms: [
        "project",
        "settings",
        "name",
        "icon",
        "scripts",
        "model",
        "workspace",
        "grouping",
        "checkout",
        "remove",
        "t3.json",
      ],
      title: "Project settings",
      description: contextualProjectGroup.displayName,
      icon: <FolderIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({
          to: "/projects/$projectKey",
          params: { projectKey: contextualProjectGroup.projectKey },
        });
      },
    });
  }

  const rootGroups = buildRootGroups({ actionItems, recentThreadItems });
  // Every setting goes to the palette's own matcher, so settings get the same
  // word starts and typo tolerance as threads.
  const settingsSearchItems: CommandPaletteActionItem[] = settingsForThisPlatform(
    SETTINGS_SEARCH_ITEMS,
  ).map((item) => ({
    kind: "action",
    value: `setting:${item.id}`,
    searchTerms: [item.title, SETTINGS_SECTION_LABELS[item.to], ...(item.searchTerms ?? [])],
    title: item.title,
    description: `Settings · ${SETTINGS_SECTION_LABELS[item.to]}`,
    ...(item.secondary ? { secondary: true } : {}),
    icon: <SettingsIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({
        to: item.to,
        hash: item.targetId ?? item.id,
        replace: pathname === item.to,
        hashScrollIntoView: false,
      });
    },
  }));
  const activeGroups =
    currentView?.groups[0]?.value === NEW_THREAD_IN_GROUP
          ? [
              {
                value: NEW_THREAD_IN_GROUP,
                label: "Projects",
                // Every project archived and no "No project" home leaves only adding one.
                items: projectThreadItems.length > 0 ? projectThreadItems : [addProjectAction],
              },
            ]
          : currentView?.groups[0]?.value === "themes"
            ? changeThemeItem.groups
            : currentView?.groups[0]?.value === "appearance"
              ? changeAppearanceItem.groups
              : (currentView?.groups ?? rootGroups);

  const isLinkedThreadSearch =
    linkedThreadSearch?.linkedThreads !== undefined && deferredQuery === linkedThreadSearch.query;
  const filteredGroups = filterCommandPaletteGroups({
    activeGroups,
    query: deferredQuery,
    isInSubmenu: currentView !== null,
    ...(deferredQuery.trim().length > 0
      ? {
          allOptions: {
            rootGroups,
            nestedItems: buildNestedSearchItems(actionItems, deferredQuery),
          },
        }
      : {}),
    projectSearchItems: projectSearchItems,
    settingsSearchItems,
    threadSearchItems:
      isLinkedThreadSearch && linkedThreadSearch?.linkedThreads
        ? buildLinkedThreadActionItems({
            ...linkedThreadSearch.linkedThreads,
            threads: visibleLinkedThreads(
              linkedThreadSearch.linkedThreads.threads,
              linkedThreadSearch.linkedThreads.environmentId,
              linkedThreadRefs,
              hiddenKeys,
              hidingAnywhere,
            ),
            query: linkedThreadSearch.query,
            icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
            runThread: async (thread) => {
              await navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
              });
            },
          })
        : allThreadItems,
    threadMessageItems: isLinkedThreadSearch ? [] : threadMessageItems,
    now: searchNow,
  });

  const handleAddProject = async (rawCwd: string) => {
    if (isExplicitRelativeProjectPath(rawCwd.trim()) && !currentProjectCwd) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to add project",
          description: "Relative paths require an active project.",
        }),
      );
      return;
    }

    const cwd = resolveProjectPathForDispatch(rawCwd, currentProjectCwd);
    if (cwd.length === 0) return;

    const existing = findProjectByPath(projects, cwd);
    if (existing) {
      // Adding an archived project's folder again brings the project back.
      if (existing.archivedAt != null) {
        void updateProjectGroup([existing], { archived: false }, "Failed to unarchive project");
      }
      const latestThread = getLatestThreadForProject(
        threads.filter((thread) => thread.environmentId === existing.environmentId),
        existing.id,
        clientSettings.sidebarThreadSortOrder,
      );
      if (latestThread && latestThread.settledOverride !== "settled") {
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(
            scopeThreadRef(latestThread.environmentId, latestThread.id),
          ),
        });
      } else {
        const navigationResult = await settlePromise(() =>
          handleNewThread(scopeProjectRef(existing.environmentId, existing.id)),
        );
        if (navigationResult._tag === "Failure") {
          const error = squashAtomCommandFailure(navigationResult);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to open project",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
          return;
        }
      }
      setOpen(false);
      return;
    }

    const added = await settlePromise(() => invoke<string | null>("projects.add", { path: cwd }));
    if (added._tag === "Failure" || added.value === null) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to add project",
          description:
            added._tag === "Failure" ? errorMessage(squashAtomCommandFailure(added)) : `${cwd} does not exist.`,
        }),
      );
      return;
    }
    const projectRef = scopeProjectRef(browseEnvironmentId, ProjectId.make(added.value));

    const navigationResult = await settlePromise(async () => {
      await waitForProject(projectRef);
      return handleNewThread(projectRef);
    });
    if (navigationResult._tag === "Failure") {
      const error = squashAtomCommandFailure(navigationResult);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to add project",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
      return;
    }
    setOpen(false);
  };

  const browseTo = async (name: string): Promise<void> => {
    const nextQuery = appendBrowsePathSegment(query, name);
    await browseNavigation.run(
      () => prefetchBrowsePath(getBrowseDirectoryPath(nextQuery)),
      () => {
        setHighlightedItemValue(null);
        setQuery(nextQuery);
        setBrowseGeneration((generation) => generation + 1);
      },
    );
  };

  const browseUp = async (): Promise<void> => {
    const parentPath = browsePath.parentPath;
    if (parentPath === null) {
      return;
    }

    await browseNavigation.run(
      () => prefetchBrowsePath(parentPath),
      () => {
        setHighlightedItemValue(null);
        setQuery(parentPath);
        setBrowseGeneration((generation) => generation + 1);
      },
    );
  };

  const resolvedAddProjectPath = hasTrailingPathSeparator(query)
    ? (browseResult?.parentPath ?? query.trim())
    : (exactBrowseEntry?.fullPath ?? query.trim());

  const canBrowseUp = !relativePathNeedsActiveProject && browsePath.canBrowseUp;

  const browseGroups = buildBrowseGroups({
    browseEntries: visibleBrowseEntries,
    browseQuery: query,
    canBrowseUp,
    upIcon: <CornerLeftUpIcon className={ITEM_ICON_CLASS} />,
    directoryIcon: <FolderIcon className={ITEM_ICON_CLASS} />,
    browseUp,
    browseTo,
  });
  const displayedGroups: CommandPaletteView["groups"] = isBrowsing
    ? relativePathNeedsActiveProject
      ? []
      : browseGroups
    : filteredGroups;
  const resultRows = buildCommandPaletteRows(displayedGroups);
  const autoHighlightsFirstRow = !isBrowsing;

  const inputPlaceholder = getCommandPaletteInputPlaceholder(paletteMode);
  const isSubmenu = paletteMode === "submenu" || paletteMode === "submenu-browse";
  const hasHighlightedBrowseItem = highlightedItemValue?.startsWith("browse:") ?? false;
  const canSubmitBrowsePath = isBrowsing && !relativePathNeedsActiveProject;
  const willCreateProjectPath =
    canSubmitBrowsePath &&
    !isBrowsePending &&
    query.trim().length > 0 &&
    !hasHighlightedBrowseItem &&
    (hasTrailingPathSeparator(query) ? !browseResult : exactBrowseEntry === null);
  const useMetaForMod = isMacPlatform(navigator.platform);
  const submitModifierLabel = useMetaForMod ? "\u2318" : "Ctrl";
  const submitActionLabel = willCreateProjectPath ? "Create & Add" : "Add";
  const addShortcutLabel = hasHighlightedBrowseItem ? `${submitModifierLabel} Enter` : "Enter";
  const fileManagerName = getLocalFileManagerName(navigator.platform);
  const canOpenProjectFromFileManager = isBrowsing;
  const fileManagerInitialPath = (() => {
    if (!canOpenProjectFromFileManager) {
      return undefined;
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      return undefined;
    }

    const initialPath = hasTrailingPathSeparator(query)
      ? (browseResult?.parentPath ?? trimmedQuery)
      : browseDirectoryPath || trimmedQuery;

    const resolvedPath = resolveProjectPathForDispatch(initialPath, currentProjectCwd);
    return resolvedPath.length > 0 ? resolvedPath : undefined;
  })();

  function isPrimaryModifierPressed(event: KeyboardEvent<HTMLInputElement>): boolean {
    return useMetaForMod ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) {
      // Confirming an IME candidate must not submit a path or select a row.
      (event as typeof event & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
      return;
    }

    const command = resolveShortcutCommand(event, keybindings, {
      platform: navigator.platform,
      context: { modelPickerOpen: false, editableFocus: true },
    });
    if (command === "thread.pin") {
      const highlightedItem = findHighlightedCommandPaletteItem(
        displayedGroups,
        highlightedItemValue ??
          (autoHighlightsFirstRow ? (resultRows.itemValues[0] ?? null) : null),
      );
      if (highlightedItem?.kind === "action" && highlightedItem.pin) {
        event.preventDefault();
        event.stopPropagation();
        highlightedItem.pin.toggle();
        return;
      }
    }
    // Global new-thread handlers ignore shortcuts while the palette is open.
    const isJump = threadJumpIndexFromCommand(command ?? "") !== null;
    const isNewThread =
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229 &&
      (command === "chat.new" ||
        command === "chat.newLocal" ||
        command === "chat.newWithoutProject");
    const matchingItem =
      isJump || isNewThread
        ? displayedGroups
            .flatMap((group) => group.items)
            .find((item) => item.shortcutCommand === command)
        : undefined;
    if (isJump || matchingItem) {
      (event as typeof event & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
      event.preventDefault();
      event.stopPropagation();
      if (matchingItem) {
        executeItem(matchingItem);
      }
      return;
    }
    if (command === "thread.copyReference") {
      event.preventDefault();
      event.stopPropagation();
      if (activeThreadReferenceCopyTarget === null) return;
      setOpen(false);
      void copyActiveThreadReference();
      return;
    }
    // ChatView ignores shortcuts while the palette is open, so intercept find here.
    if (command === "chat.find" && activeThreadKey !== null && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      openThreadFind(activeThreadKey);
      return;
    }

    const shouldSubmitBrowsePath =
      canSubmitBrowsePath &&
      event.key === "Enter" &&
      (!hasHighlightedBrowseItem || isPrimaryModifierPressed(event));

    if (shouldSubmitBrowsePath) {
      event.preventDefault();
      void handleAddProject(resolvedAddProjectPath);
      return;
    }

    if (event.key === "Backspace" && query === "" && isSubmenu) {
      event.preventDefault();
      popView();
      return;
    }

    if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;

    if (event.key === "Tab" && isBrowsing && !relativePathNeedsActiveProject) {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      (event as typeof event & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
      event.preventDefault();
      if (highlightedItemValue === "browse:up") {
        void browseUp();
        return;
      }
      const highlightedEntry = visibleBrowseEntries.find(
        (entry) => `browse:${entry.fullPath}` === highlightedItemValue,
      );
      const completion = highlightedEntry
        ? { name: highlightedEntry.name, isComplete: true }
        : getFilesystemBrowseTabCompletion(visibleBrowseEntries, browsePath.filterQuery);
      if (completion?.isComplete) {
        void browseTo(completion.name);
      } else if (completion) {
        setHighlightedItemValue(null);
        setQuery(`${getBrowseDirectoryPath(query)}${completion.name}`);
      }
      return;
    }

    const firstItemValue = autoHighlightsFirstRow ? resultRows.itemValues[0] : undefined;
    if (
      event.key === "ArrowDown" &&
      highlightClearedRef.current &&
      firstItemValue &&
      !event.nativeEvent.isComposing
    ) {
      (event as typeof event & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
      event.preventDefault();
      highlightClearedRef.current = false;
      setHighlightedItemValue(firstItemValue);
      scrollCommandPaletteRowIntoView(
        resultListRef.current,
        resultRows.rowIndexByItemIndex[0] ?? 0,
        true,
      );
      return;
    }

    // Virtualization may unmount the highlighted row; handle Enter directly instead of Base UI's click.
    if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      const highlightedItem = findHighlightedCommandPaletteItem(
        displayedGroups,
        highlightedItemValue ?? firstItemValue ?? null,
      );
      if (highlightedItem) {
        (event as typeof event & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
        event.preventDefault();
        event.stopPropagation();
        executeItem(highlightedItem);
      }
    }
  }

  function executeItem(item: CommandPaletteActionItem | CommandPaletteSubmenuItem): void {
    if (item.disabled) {
      return;
    }

    if (item.kind === "submenu") {
      pushPaletteView(item);
      return;
    }

    if (!item.keepOpen) {
      setOpen(false);
    }

    void item.run().catch((error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to run command",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    });
  }

  const handleOpenProjectFromFileManager = async () => {
    if (!canOpenProjectFromFileManager || isPickingProjectFolder) {
      return;
    }
    setIsPickingProjectFolder(true);
    const picked = await settlePromise(() =>
      invoke<string | null>("dialog.pickFolder", { initialPath: fileManagerInitialPath ?? null }),
    );
    setIsPickingProjectFolder(false);
    if (picked._tag === "Failure" || typeof picked.value !== "string") {
      return;
    }
    await handleAddProject(picked.value);
  };

  const submitButtonId = useId();
  const browseSubmitLabel = `${submitActionLabel} (${addShortcutLabel})`;
  const inputAccessory = isBrowsing ? (
    <CommandPaletteSubmitButton
      id={submitButtonId}
      label={submitActionLabel}
      shortcutLabel={addShortcutLabel}
      ariaLabel={browseSubmitLabel}
      tooltip={browseSubmitLabel}
      disabled={relativePathNeedsActiveProject}
      onSubmit={() => {
        if (relativePathNeedsActiveProject) {
          return;
        }
        void handleAddProject(resolvedAddProjectPath);
      }}
    />
  ) : null;

  const footerActionLabel = !canSubmitBrowsePath || hasHighlightedBrowseItem ? "Select" : undefined;

  const footerTrailing = canOpenProjectFromFileManager ? (
    <CommandFooterAction
      disabled={isPickingProjectFolder}
      onClick={() => {
        void handleOpenProjectFromFileManager();
      }}
    >
      {`Open in ${fileManagerName}`}
    </CommandFooterAction>
  ) : isThreadSearchPending && !isLinkedThreadSearch && !isBrowsing ? (
    // In the footer, so the list keeps its height while message results may
    // still arrive below it.
    <span className="text-muted-foreground text-xs">Searching messages…</span>
  ) : null;

  return (
    <CommandPaletteContent
      key={`${viewStack.length}-${browseGeneration}-${isBrowsing}`}
      aria-label="Command palette"
      autoHighlight={autoHighlightsFirstRow ? "always" : false}
      footerActionLabel={footerActionLabel}
      footerTrailing={footerTrailing}
      inputAccessory={inputAccessory}
      inputProps={{
        className: isBrowsing
          ? browseInputEndPaddingClass({
              willCreateProjectPath,
              hasHighlightedBrowseItem,
            })
          : undefined,
        placeholder: inputPlaceholder,
        "aria-describedby": inputAccessory ? submitButtonId : undefined,
        ...(isSubmenu
          ? {
              startAddon: (
                <button
                  type="button"
                  className="flex cursor-pointer items-center"
                  aria-label="Back"
                  onClick={popView}
                >
                  <ArrowLeftIcon />
                </button>
              ),
            }
          : isBrowsing
            ? { startAddon: <FolderPlusIcon /> }
            : {}),
        onKeyDown: handleKeyDown,
      }}
      mode="none"
      items={resultRows.itemValues}
      virtualized
      onItemHighlighted={(value, eventDetails) => {
        if (eventDetails.reason === "none" && highlightClearedRef.current) return;
        highlightClearedRef.current = false;
        setHighlightedItemValue(typeof value === "string" ? value : null);
        const rowIndex = resultRows.rowIndexByItemIndex[eventDetails.index];
        if (eventDetails.reason === "keyboard" && rowIndex !== undefined) {
          scrollCommandPaletteRowIntoView(
            resultListRef.current,
            rowIndex,
            eventDetails.index === 0,
          );
        }
      }}
      onValueChange={(nextQuery, { event }) => handleQueryChange(nextQuery, event.target)}
      pendingSelectionRef={remountSelectionRef}
      showBackHint={isSubmenu}
      value={query}
    >
      {isBrowsePending && browseResult === undefined ? (
        <div role="status" className="px-4 py-3 text-sm text-muted-foreground">
          Loading folders...
        </div>
      ) : null}
      <CommandPaletteVirtualizedResults
        rows={resultRows.rows}
        listRef={resultListRef}
        highlightedItemValue={highlightedItemValue}
        isActionsOnly={isActionsOnly}
        keybindings={keybindings}
        onExecuteItem={executeItem}
        {...(relativePathNeedsActiveProject
              ? { emptyStateMessage: "Relative paths require an active project." }
              : willCreateProjectPath
                ? {
                    emptyStateMessage: "Press Enter to create this folder and add it as a project.",
                  }
                : isThreadSearchPending
                  ? { emptyStateMessage: "Searching thread messages…" }
                  : {})}
      />
    </CommandPaletteContent>
  );
}
