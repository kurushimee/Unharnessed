import { CircleAlertIcon, FolderIcon, HomeIcon, PanelRightIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SettingsState } from "@shared/protocol";
import { Composer, type ImageSettings } from "@panel/Composer";
import { Transcript } from "@panel/Chat";
import { PathsContext } from "@panel/mentions";
import { post } from "~/bridge";
import { cn } from "~/lib/utils";
import { endEdit, set, useStore } from "~/state";
import { useGitStatus } from "~/hooks/useGitStatus";
import { threadTitle, ThreadMenuItems } from "./AppSidebar";
import { ProjectIcon } from "./ProjectIcon";
import { GitActionsControl } from "./GitControls";
import { ThreadDetails } from "./ThreadDetails";
import { Button } from "./ui/button";
import { Menu, MenuPopup, MenuTrigger } from "./ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { WorkspaceHeader } from "./WorkspaceHeader";

/** The image settings as the agent applies them: the file's value, else the agent's default. */
function imageSettings({ view }: SettingsState): ImageSettings {
  const value = (key: string) => view?.values[key] ?? view?.defaults[key] ?? null;
  return {
    block: value("images.blockImages") === true,
    resize: value("images.autoResize") !== false,
    imageModel: typeof value("imageModel") === "string" ? (value("imageModel") as string) : null,
  };
}

export function ThreadView() {
  const app = useStore((state) => state.app);
  const agent = useStore((state) => state.agent);
  const session = useStore((state) => state.session);
  const providers = useStore((state) => state.providers);
  const chat = useStore((state) => state.chat);
  const kernel = useStore((state) => state.kernel);
  const settings = useStore((state) => state.settings);
  const draft = useStore((state) => state.draft);
  const editing = useStore((state) => state.editing);
  const paths = useStore((state) => state.paths);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const shown = app?.shown;
  const row = shown?.id ? app?.threads.find((thread) => thread.id === shown.id) : undefined;
  const project = shown?.projectId ? app?.projects.find((p) => p.id === shown.projectId) : undefined;
  const cwd = shown?.cwd ?? null;
  // The home folder is no project: no git there.
  const git = useGitStatus(project ? cwd : null, chat.busy);
  const images = useMemo(() => imageSettings(settings), [settings]);
  const unconnected = providers !== null && !providers.some((p) => p.connected);

  // The edited turn or waiting message left (a new conversation, a restarted agent): the text stays, as a new message.
  useEffect(() => {
    if (!editing) return;
    const turn = chat.entries.find((entry) => entry.id === editing.id);
    const left = editing.queued ? !chat.queue.some((message) => message.id === editing.id) : turn?.kind !== "turn" || turn.rewindTo === undefined;
    if (left) set({ editing: null });
  }, [chat.entries, chat.queue, editing]);

  if (!agent) return <div className="flex-1" />;
  const kind = agent.kind === "failed" ? "failed" : chat.loading || agent.kind === "starting" ? "starting" : null;
  const label = kind === "starting" ? (chat.loading ? "Opening the conversation" : "Starting agent") : kind === "failed" ? "Agent stopped" : null;
  const empty = chat.entries.length === 0 && !kind;
  const title = row ? threadTitle(row) : "New thread";
  const projectName = project?.name ?? "Home";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspaceHeader>
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <span className="flex min-w-0 shrink items-center gap-1.5 text-muted-foreground" title={cwd ?? undefined}>
            {project ? <ProjectIcon name={project.name} className="size-4" /> : <HomeIcon className="size-4" />}
            <span className="truncate">{projectName}</span>
          </span>
          <span className="text-muted-foreground/50">/</span>
          {renaming && row ? (
            <input
              autoFocus
              defaultValue={row.title ?? ""}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) => {
                setRenaming(false);
                const value = event.currentTarget.value.trim();
                if (value !== (row.title ?? "")) post({ type: "rename", id: row.id, title: value || null });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  event.currentTarget.value = row.title ?? "";
                  event.currentTarget.blur();
                }
              }}
              className="no-drag h-7 min-w-0 flex-1 rounded-md border border-ring bg-background px-2 text-sm outline-none"
            />
          ) : row ? (
            <Menu>
              <MenuTrigger
                render={
                  <button
                    type="button"
                    onDoubleClick={() => setRenaming(true)}
                    className="no-drag min-w-0 truncate rounded-md px-1 py-0.5 text-left font-medium text-foreground hover:bg-accent"
                  />
                }
              >
                {title}
              </MenuTrigger>
              <MenuPopup align="start">
                <ThreadMenuItems thread={row} onRename={() => setRenaming(true)} />
              </MenuPopup>
            </Menu>
          ) : (
            <span className="truncate font-medium text-foreground">{title}</span>
          )}
          {row?.branch ? <span className="hidden truncate font-mono text-xs text-muted-foreground lg:inline">{row.branch}</span> : null}
        </div>
        <div className="no-drag flex shrink-0 items-center gap-1.5">
          {cwd && project ? <GitActionsControl cwd={cwd} status={git.status} refresh={git.refresh} /> : null}
          <Popover open={detailsOpen} onOpenChange={setDetailsOpen}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <PopoverTrigger
                    render={<Button size="icon-sm" variant="ghost" aria-label="Thread details" className={cn(detailsOpen && "bg-accent")} />}
                  />
                }
              >
                <PanelRightIcon />
              </TooltipTrigger>
              <TooltipPopup side="bottom">Thread details</TooltipPopup>
            </Tooltip>
            <PopoverPopup align="end" variant="panel" padding="none" className="w-[var(--thread-details-panel-width)]">
              {cwd ? <ThreadDetails cwd={cwd} git={git} row={row} usage={chat.usage} project={project ?? null} /> : null}
            </PopoverPopup>
          </Popover>
        </div>
      </WorkspaceHeader>
      <PathsContext.Provider value={paths}>
        <div className="screen kuru-chat relative min-h-0 flex-1">
          {empty ? <DraftHero projectName={projectName} isProject={!!project} /> : null}
          <Transcript chat={chat} editing={editing?.id ?? null}>
            {kind ? (
              <div className={cn("mx-auto flex items-center gap-2 py-6 text-sm text-muted-foreground", kind === "failed" && "text-destructive-foreground")}>
                {kind === "failed" ? <CircleAlertIcon className="size-4" /> : <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                <span>{label}</span>
              </div>
            ) : null}
            {agent.kind === "failed" ? (
              <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
                <p className="text-sm text-destructive-foreground">{agent.error}</p>
                {agent.stderr.length > 0 ? <pre className="max-h-64 overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs">{agent.stderr.join("\n")}</pre> : null}
                <Button className="self-start" variant="outline" onClick={() => post({ type: "restartAgent" })}>
                  <RotateCcwIcon />
                  Restart agent
                </Button>
              </div>
            ) : null}
          </Transcript>
          {agent.kind === "ready" ? (
            <Composer
              session={session}
              providers={providers ?? []}
              unconnected={unconnected}
              chat={chat}
              kernel={kernel}
              images={images}
              draft={draft}
              onDraft={(update) => set((state) => ({ draft: update(state.draft) }))}
              editing={editing?.id ?? null}
              onEditEnd={endEdit}
              onProviders={() => set({ settingsOpen: "providers" })}
            />
          ) : null}
        </div>
      </PathsContext.Provider>
    </div>
  );
}

/** A thread nothing was asked in yet: T3 Code's draft headline over the composer. */
function DraftHero({ projectName, isProject }: { projectName: string; isProject: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-x-0 top-[22%] z-0 flex flex-col items-center gap-2 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground/90">What should we work on?</h1>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {isProject ? <FolderIcon className="size-3.5" /> : <HomeIcon className="size-3.5" />}
        {projectName}
      </p>
    </div>
  );
}
