import {
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ChartNoAxesColumnIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CopyIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitPullRequestIcon,
  HomeIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Project, ThreadRow } from "@shared/protocol";
import { invoke, post } from "~/bridge";
import { cn } from "~/lib/utils";
import { baseName, stamp } from "~/lib/format";
import { useNow } from "~/hooks/useNow";
import { get, set, useStore } from "~/state";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator } from "./ui/menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { ProjectIcon } from "./ProjectIcon";
import { confirmAction } from "./confirm";

const COLLAPSED_KEY = "kuru:collapsedProjects";
const SETTLED_SHOWN_KEY = "kuru:settledShown";

function readSet(key: string): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

type ContextMenu = { kind: "thread"; thread: ThreadRow; x: number; y: number } | { kind: "project"; project: Project; x: number; y: number };

export function threadTitle(thread: Pick<ThreadRow, "title">): string {
  return thread.title?.trim() || "New thread";
}

export function newThread(projectId?: string | null): void {
  const { draft } = get();
  set({ main: { kind: "thread" }, settingsOpen: null });
  post({ type: "newChat", draft: { text: "", images: [] }, ...(projectId !== undefined ? { projectId } : {}) });
  void draft;
}

export function openThread(id: string): void {
  set({ main: { kind: "thread" }, settingsOpen: null });
  post({ type: "openChat", id, draft: get().draft });
}

export async function deleteThread(thread: ThreadRow): Promise<void> {
  if (get().prefs.confirmDelete) {
    const ok = await confirmAction({
      title: `Delete "${threadTitle(thread)}"?`,
      description: "The conversation and its session file are deleted. This can't be undone.",
      confirm: "Delete",
      destructive: true,
    });
    if (!ok) return;
  }
  post({ type: "deleteChat", id: thread.id });
}

export function AppSidebar() {
  const app = useStore((state) => state.app);
  const main = useStore((state) => state.main);
  const settingsOpen = useStore((state) => state.settingsOpen);
  const usageOpen = useStore((state) => state.usageOpen);
  const prefs = useStore((state) => state.prefs);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readSet(COLLAPSED_KEY));
  const [settledShown, setSettledShown] = useState(() => readSet(SETTLED_SHOWN_KEY));
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])), [collapsed]);
  useEffect(() => localStorage.setItem(SETTLED_SHOWN_KEY, JSON.stringify([...settledShown])), [settledShown]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearching(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        newThread();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shownId = app?.shown.id;
  const onUtilityPage = main.kind === "prs" || usageOpen || settingsOpen !== null;
  const threads = app?.threads ?? [];
  const projects = app?.projects ?? [];
  const needle = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const visible = needle
      ? threads.filter((thread) => threadTitle(thread).toLowerCase().includes(needle) || (thread.branch ?? "").toLowerCase().includes(needle))
      : threads;
    const byProject = new Map<string | null, ThreadRow[]>();
    for (const thread of visible) {
      const list = byProject.get(thread.projectId) ?? [];
      list.push(thread);
      byProject.set(thread.projectId, list);
    }
    for (const list of byProject.values()) list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
    const working = prefs.workingSection && !needle ? visible.filter((thread) => thread.mark === "working") : [];
    return { byProject, working };
  }, [threads, needle, prefs.workingSection]);

  const toggleProject = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleSettled = (id: string) =>
    setSettledShown((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rowProps = {
    shownId,
    timestampFormat: prefs.timestampFormat,
    renaming,
    onRenameDone: () => setRenaming(null),
    onContextMenu: (thread: ThreadRow, event: ReactMouseEvent) => {
      event.preventDefault();
      setMenu({ kind: "thread", thread, x: event.clientX, y: event.clientY });
    },
  };

  const homeThreads = groups.byProject.get(null) ?? [];
  const folders: { key: string; project: Project | null; threads: ThreadRow[] }[] = [
    ...projects.map((project) => ({ key: project.id, project, threads: groups.byProject.get(project.id) ?? [] })),
    ...(homeThreads.length > 0 ? [{ key: "~", project: null, threads: homeThreads }] : []),
  ];

  return (
    <Sidebar
      side="left"
      collapsible="offcanvas"
      data-app-sidebar=""
      role="navigation"
      aria-label="Threads"
      resizable={{ minWidth: 220, maxWidth: 480, storageKey: "kuru:sidebarWidth" }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        // A folder dropped on the sidebar becomes a project.
        const files = [...event.dataTransfer.files];
        if (files.length === 0) return;
        event.preventDefault();
        for (const file of files) {
          const path = window.kuru.pathForFile(file);
          if (path && !file.type) void invoke("projects.add", { path });
        }
      }}
    >
      <div className="drag-region relative flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 pr-3 pl-[calc(var(--workspace-controls-left)+2.25rem)]">
        <span className="inline-flex items-baseline gap-1 text-sm font-medium tracking-tight select-none">
          <span className="font-semibold text-foreground">kuru</span>
          <span className="text-muted-foreground">code</span>
        </span>
      </div>
      <div className="flex flex-col gap-0.5 px-2 pb-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => newThread()} className="text-sidebar-foreground">
              <SquarePenIcon />
              <span>New thread</span>
              <span className="ml-auto text-2xs text-muted-foreground/70">Ctrl+Shift+O</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            {searching || query ? (
              <div className="flex h-8 items-center gap-2 rounded-md bg-sidebar-control-surface px-2.5">
                <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onBlur={() => !query && setSearching(false)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setQuery("");
                      setSearching(false);
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="Search threads"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
                />
                {query ? (
                  <button type="button" aria-label="Clear search" className="text-muted-foreground hover:text-foreground" onClick={() => setQuery("")}>
                    <XIcon className="size-3.5" />
                  </button>
                ) : null}
              </div>
            ) : (
              <SidebarMenuButton
                onClick={() => {
                  setSearching(true);
                  requestAnimationFrame(() => searchRef.current?.focus());
                }}
                className="text-sidebar-foreground"
              >
                <SearchIcon />
                <span>Search</span>
                <span className="ml-auto text-2xs text-muted-foreground/70">Ctrl+K</span>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
      <SidebarContent className="px-2 pb-2">
        {groups.working.length > 0 ? (
          <section className="mb-3">
            <h3 className="mb-1 flex h-6 items-center px-2.5 text-2xs font-medium text-muted-foreground select-none">Working</h3>
            <ul className="flex flex-col gap-px">
              {groups.working.map((thread) => (
                <ThreadRowItem key={thread.id} thread={thread} project={projects.find((p) => p.id === thread.projectId) ?? null} showProject {...rowProps} />
              ))}
            </ul>
          </section>
        ) : null}
        <div className="mb-1 flex h-6 items-center justify-between px-2.5">
          <h3 className="text-2xs font-medium text-muted-foreground select-none">Projects</h3>
          <Tooltip>
            <TooltipTrigger render={<Button size="icon-xs" variant="ghost-muted" aria-label="Add project" onClick={() => post({ type: "addProject" })} />}>
              <FolderPlusIcon />
            </TooltipTrigger>
            <TooltipPopup>Add project</TooltipPopup>
          </Tooltip>
        </div>
        {app && projects.length === 0 && homeThreads.length === 0 && !needle ? (
          <div className="mx-1 mt-2 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            <p className="mb-2">Add a project folder to start threads in it.</p>
            <Button size="xs" variant="outline" onClick={() => post({ type: "addProject" })}>
              <FolderPlusIcon />
              Add project
            </Button>
          </div>
        ) : null}
        <ul className="flex flex-col">
          {folders.map(({ key, project, threads: list }) => {
            if (needle && list.length === 0) return null;
            const isCollapsed = collapsed.has(key) && !needle;
            const active = list.filter((thread) => !thread.settled || thread.id === shownId);
            const settled = list.filter((thread) => thread.settled && thread.id !== shownId);
            const showSettled = settledShown.has(key) || !!needle;
            const working = list.some((thread) => thread.mark === "working");
            const unread = list.some((thread) => thread.mark === "unread");
            const name = project?.name ?? "Home";
            return (
              <li key={key} className="group/project-folder relative mt-1 list-none first:mt-0">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleProject(key)}
                  onContextMenu={(event) => {
                    if (!project) return;
                    event.preventDefault();
                    setMenu({ kind: "project", project, x: event.clientX, y: event.clientY });
                  }}
                  title={project?.path ?? app?.home}
                  className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {project ? <ProjectIcon name={name} className="size-4 shrink-0" /> : <HomeIcon className="size-4 shrink-0 text-muted-foreground" />}
                  <span className={cn("min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground/90", project?.missing && "line-through opacity-60")}>{name}</span>
                  {working ? (
                    <span className="size-1.5 shrink-0 animate-status-pulse rounded-full bg-info" />
                  ) : unread ? (
                    <span className="size-1.5 shrink-0 rounded-full bg-success" />
                  ) : null}
                  {isCollapsed && active.length > 0 ? (
                    <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground group-hover/project-folder:invisible">{active.length}</span>
                  ) : null}
                  <ChevronDownIcon aria-hidden className={cn("size-3 shrink-0 text-sidebar-muted-foreground transition-transform", isCollapsed && "-rotate-90")} />
                </button>
                <span className="absolute top-0 right-6 flex h-8 items-center opacity-0 focus-within:opacity-100 group-hover/project-folder:opacity-100">
                  <Tooltip>
                    <TooltipTrigger
                      render={<Button size="icon-xs" variant="ghost-muted" aria-label={`New thread in ${name}`} onClick={() => newThread(project?.id ?? null)} />}
                    >
                      <SquarePenIcon aria-hidden />
                    </TooltipTrigger>
                    <TooltipPopup>New thread in {name}</TooltipPopup>
                  </Tooltip>
                </span>
                {isCollapsed ? null : (
                  <ul className="mt-px flex flex-col gap-px">
                    {active.map((thread) => (
                      <ThreadRowItem key={thread.id} thread={thread} project={project} {...rowProps} />
                    ))}
                    {active.length === 0 && settled.length === 0 ? (
                      <li className="list-none py-1 ps-9 text-xs text-muted-foreground/70 select-none">No threads yet</li>
                    ) : null}
                    {settled.length > 0 ? (
                      <li className="list-none">
                        <button
                          type="button"
                          onClick={() => toggleSettled(key)}
                          className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md ps-9 pe-2.5 text-left text-xs text-muted-foreground/80 hover:bg-sidebar-row-hover hover:text-foreground"
                        >
                          <ChevronDownIcon className={cn("size-3 transition-transform", !showSettled && "-rotate-90")} />
                          {showSettled ? "Hide settled" : `${settled.length} settled`}
                        </button>
                      </li>
                    ) : null}
                    {showSettled ? settled.map((thread) => <ThreadRowItem key={thread.id} thread={thread} project={project} {...rowProps} />) : null}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu className="flex-row items-center">
          {onUtilityPage ? (
            <SidebarMenuItem className="min-w-0 flex-1">
              <SidebarMenuButton onClick={() => set({ main: { kind: "thread" }, settingsOpen: null, usageOpen: false })}>
                <ArrowLeftIcon />
                <span>Back</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : (
            <>
              <UtilityItem label="Settings" onClick={() => set({ settingsOpen: "general", usageOpen: false })}>
                <SettingsIcon />
              </UtilityItem>
              <UtilityItem label="Pull requests" onClick={() => set({ main: { kind: "prs" }, settingsOpen: null, usageOpen: false })}>
                <GitPullRequestIcon />
              </UtilityItem>
              <UtilityItem label="Usage" onClick={() => set({ usageOpen: true, settingsOpen: null })}>
                <ChartNoAxesColumnIcon />
              </UtilityItem>
            </>
          )}
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
      <Menu open={menu !== null} onOpenChange={(open) => !open && setMenu(null)}>
        {menu ? (
          <MenuPopup anchor={pointAnchor(menu.x, menu.y)} side="bottom" align="start" sideOffset={2}>
            {menu.kind === "thread" ? (
              <ThreadMenuItems thread={menu.thread} onRename={() => setRenaming(menu.thread.id)} />
            ) : (
              <>
                <MenuItem onClick={() => newThread(menu.project.id)}>
                  <SquarePenIcon />
                  New thread
                </MenuItem>
                <MenuItem onClick={() => void invoke("shell.openPath", { path: menu.project.path })}>
                  <FolderOpenIcon />
                  Open folder
                </MenuItem>
                <MenuItem onClick={() => void navigator.clipboard.writeText(menu.project.path)}>
                  <CopyIcon />
                  Copy path
                </MenuItem>
                <MenuSeparator />
                <MenuItem variant="destructive" onClick={() => post({ type: "removeProject", id: menu.project.id })}>
                  <Trash2Icon />
                  Remove project
                </MenuItem>
              </>
            )}
          </MenuPopup>
        ) : null}
      </Menu>
    </Sidebar>
  );
}

export function ThreadMenuItems({ thread, onRename }: { thread: ThreadRow; onRename: () => void }) {
  return (
    <>
      <MenuItem onClick={onRename}>
        <PencilIcon />
        Rename
      </MenuItem>
      <MenuItem onClick={() => post({ type: "pin", id: thread.id, pinned: !thread.pinned })}>
        {thread.pinned ? <PinOffIcon /> : <PinIcon />}
        {thread.pinned ? "Unpin" : "Pin"}
      </MenuItem>
      <MenuItem onClick={() => post({ type: "settle", id: thread.id, settled: !thread.settled })}>
        {thread.settled ? <ArchiveRestoreIcon /> : <CheckIcon />}
        {thread.settled ? "Un-settle" : "Settle"}
      </MenuItem>
      <MenuItem onClick={() => void navigator.clipboard.writeText(thread.cwd)}>
        <CopyIcon />
        Copy working directory
      </MenuItem>
      <MenuItem onClick={() => void navigator.clipboard.writeText(thread.id)}>
        <CopyIcon />
        Copy session id
      </MenuItem>
      <MenuSeparator />
      <MenuItem variant="destructive" onClick={() => void deleteThread(thread)}>
        <Trash2Icon />
        Delete
      </MenuItem>
    </>
  );
}

export function pointAnchor(x: number, y: number) {
  return { getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) };
}

function UtilityItem({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={label} onClick={onClick} size="icon">
              {children}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

const ThreadRowItem = memo(function ThreadRowItem({
  thread,
  project,
  shownId,
  showProject = false,
  timestampFormat,
  renaming,
  onRenameDone,
  onContextMenu,
}: {
  thread: ThreadRow;
  project: Project | null;
  shownId: string | undefined;
  showProject?: boolean;
  timestampFormat: "relative" | "24h" | "12h";
  renaming: string | null;
  onRenameDone: () => void;
  onContextMenu: (thread: ThreadRow, event: ReactMouseEvent) => void;
}) {
  const now = useNow(30_000);
  const isActive = thread.id === shownId;
  const title = threadTitle(thread);
  const status =
    thread.mark === "working"
      ? { label: "Working", icon: CircleDashedIcon, className: "text-info-foreground" }
      : thread.mark === "unread"
        ? { label: "Done", icon: CircleCheckIcon, className: "text-success-foreground" }
        : null;
  const recede = thread.settled && !isActive;
  if (renaming === thread.id) {
    return (
      <li className="list-none">
        <RenameInput
          title={thread.title ?? ""}
          onDone={(value) => {
            onRenameDone();
            if (value !== null && value.trim() !== (thread.title ?? "")) post({ type: "rename", id: thread.id, title: value.trim() || null });
          }}
        />
      </li>
    );
  }
  return (
    <li className="list-none">
      <div
        role="button"
        tabIndex={0}
        aria-current={isActive ? "page" : undefined}
        data-thread-id={thread.id}
        onClick={() => !isActive && openThread(thread.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!isActive) openThread(thread.id);
          }
        }}
        onContextMenu={(event) => onContextMenu(thread, event)}
        title={`${title}${thread.branch ? `\n${thread.branch}` : ""}${thread.model ? `\n${thread.model}` : ""}`}
        className={cn(
          "group/sidebar-row relative flex h-8 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md ps-9 pe-2 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          showProject && "ps-2.5",
          isActive
            ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
            : recede
              ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-row-hover",
        )}
      >
        {showProject ? project ? <ProjectIcon name={project.name} className="size-4 shrink-0" /> : <HomeIcon className="size-4 shrink-0 text-muted-foreground" /> : null}
        <span className={cn("min-w-0 flex-1 truncate text-sm", recede ? "font-normal" : thread.mark === "unread" || isActive ? "font-medium text-foreground" : "font-normal text-foreground/85")}>
          {title}
        </span>
        {thread.pinned ? <PinIcon aria-label="Pinned" className="size-3 shrink-0 text-muted-foreground/65" /> : null}
        <span className="relative ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end">
          <span className="inline-flex items-center gap-1 text-xs tabular-nums text-secondary-label transition-opacity group-hover/sidebar-row:opacity-0">
            {status ? (
              <span className={cn("inline-flex items-center gap-1 font-medium", status.className)}>
                <status.icon aria-hidden className={cn("size-3", thread.mark === "working" && "animate-spin [animation-duration:2.5s]")} />
                {status.label}
              </span>
            ) : (
              stamp(thread.updated, timestampFormat, now)
            )}
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center opacity-0 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={thread.settled ? "Un-settle thread" : "Settle thread"}
                    onClick={(event) => {
                      event.stopPropagation();
                      post({ type: "settle", id: thread.id, settled: !thread.settled });
                    }}
                    className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:text-foreground"
                  />
                }
              >
                {thread.settled ? <ArchiveRestoreIcon className="size-3.5" /> : <CheckIcon className="size-3.5" />}
              </TooltipTrigger>
              <TooltipPopup side="top">{thread.settled ? "Un-settle thread" : "Settle thread"}</TooltipPopup>
            </Tooltip>
          </span>
        </span>
      </div>
    </li>
  );
});

function RenameInput({ title, onDone }: { title: string; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(title);
  const done = useRef(false);
  const finish = (result: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(result);
  };
  return (
    <input
      autoFocus
      value={value}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(value);
        if (event.key === "Escape") finish(null);
      }}
      className="h-8 w-full rounded-md border border-ring bg-background ps-9 pe-2 text-sm outline-none"
    />
  );
}

export { SidebarTrigger };
