import {
  CodeIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  FolderOpenIcon,
  GitPullRequestIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { ChangedFile } from "@shared/git";
import type { Project, ThreadRow, Usage } from "@shared/protocol";
import { invoke } from "~/bridge";
import { cn } from "~/lib/utils";
import { compact, dollars, longAgo } from "~/lib/format";
import type { GitState } from "~/hooks/useGitStatus";
import { set } from "~/state";
import { BranchPicker } from "./GitControls";
import { Button } from "./ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";
import { Spinner } from "./ui/spinner";
import { toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

function Section({ title, children, separated = true }: { title: string; children: ReactNode; separated?: boolean }) {
  return (
    <section aria-label={title} className={cn("px-2 pt-2 pb-2.5", separated && "border-t border-border/65")}>
      <h3 className="mb-1 flex min-h-6 items-center px-2.5 text-2xs font-medium text-muted-foreground select-none">{title}</h3>
      {children}
    </section>
  );
}

const OPENERS = [
  { target: "vscode", label: "VS Code", icon: CodeIcon },
  { target: "cursor", label: "Cursor", icon: CodeIcon },
  { target: "terminal", label: "Terminal", icon: SquareTerminalIcon },
  { target: "explorer", label: "Explorer", icon: FolderOpenIcon },
] as const;

async function openIn(path: string, target: string) {
  const error = await invoke<string | null>("open.in", { path, target });
  if (error) toastManager.add({ type: "error", title: "Could not open the folder", description: error });
}

/** T3 Code's thread details card: the workspace, its git state, the pull request, the context. */
export function ThreadDetails({
  cwd,
  git,
  row,
  usage,
  project,
}: {
  cwd: string;
  git: GitState;
  row: ThreadRow | undefined;
  usage: Usage | null;
  project: Project | null;
}) {
  const [diffOpen, setDiffOpen] = useState(false);
  const status = git.status;
  const repo = status?.repo ? status : null;
  return (
    <div className="flex max-h-[min(36rem,calc(100vh-6rem))] flex-col overflow-y-auto text-sm">
      <Section title="Workspace" separated={false}>
        <button
          type="button"
          title="Open in Explorer"
          onClick={() => void openIn(cwd, "explorer")}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent"
        >
          <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs" dir="rtl">
            {cwd}
          </span>
        </button>
        <div className="mt-1 grid grid-cols-4 gap-1 px-1">
          {OPENERS.map(({ target, label, icon: Icon }) => (
            <Tooltip key={target}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="flex h-12 flex-col items-center justify-center gap-1 rounded-md px-1 text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => void openIn(cwd, target)}
                  />
                }
              >
                <Icon className="size-4" />
                {label}
              </TooltipTrigger>
              <TooltipPopup>Open in {label}</TooltipPopup>
            </Tooltip>
          ))}
        </div>
      </Section>
      {project ? (
      <Section title="Version control">
        {status === null ? (
          <div className="flex justify-center py-2">
            <Spinner className="size-4" />
          </div>
        ) : !repo ? (
          <p className="px-2.5 py-1 text-xs text-muted-foreground">{project ? "This folder is not a git repository." : "Not a git repository."}</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            <BranchPicker cwd={cwd} status={repo} refresh={git.refresh} />
            <button
              type="button"
              onClick={() => setDiffOpen(true)}
              disabled={repo.changedFiles === 0 && !repo.diff?.added && !repo.diff?.removed}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs enabled:hover:bg-accent disabled:opacity-60"
            >
              <FileDiffIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {repo.changedFiles > 0 ? `${repo.changedFiles} uncommitted file${repo.changedFiles === 1 ? "" : "s"}` : "No uncommitted changes"}
              </span>
              {repo.diff && (repo.diff.added > 0 || repo.diff.removed > 0) ? (
                <span className="shrink-0 font-mono" title={`Against ${repo.diff.against}`}>
                  <span className="text-diff-addition-foreground">+{compact(repo.diff.added)}</span>{" "}
                  <span className="text-diff-deletion-foreground">−{compact(repo.diff.removed)}</span>
                </span>
              ) : null}
            </button>
            <div className="flex items-center gap-3 px-2.5 py-1 text-2xs text-muted-foreground">
              {repo.upstream ? <span>↑{repo.ahead} ↓{repo.behind}</span> : <span>Not pushed</span>}
              {repo.defaultBranch && repo.branch !== repo.defaultBranch ? (
                <span>
                  {repo.aheadOfDefault} commit{repo.aheadOfDefault === 1 ? "" : "s"} ahead of {repo.defaultBranch}
                </span>
              ) : null}
            </div>
            {repo.pr ? (
              <div className="flex items-center gap-2 rounded-md px-2.5 py-1.5 hover:bg-accent">
                <GitPullRequestIcon
                  className={cn(
                    "size-4 shrink-0",
                    repo.pr.state === "merged" ? "text-violet-500" : repo.pr.state === "closed" ? "text-destructive-foreground" : repo.pr.draft ? "text-muted-foreground" : "text-success-foreground",
                  )}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-xs"
                  title={repo.pr.title}
                  onClick={() => repo.github && set({ main: { kind: "prs", selected: { repo: repo.github, number: repo.pr!.number } } })}
                >
                  <span className="text-muted-foreground">#{repo.pr.number}</span> {repo.pr.title}
                </button>
                <Button size="icon-xs" variant="ghost-muted" aria-label="Open on GitHub" onClick={() => void invoke("shell.openExternal", { url: repo.pr!.url })}>
                  <ExternalLinkIcon />
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Section>
      ) : null}
      {usage ? (
        <Section title="Context">
          <ContextRow usage={usage} />
        </Section>
      ) : null}
      {row ? (
        <Section title="Thread">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-2.5 text-xs">
            {row.model ? (
              <>
                <dt className="text-muted-foreground">Model</dt>
                <dd className="truncate text-right">{row.model}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Started</dt>
            <dd className="text-right">{longAgo(row.created)}</dd>
            <dt className="text-muted-foreground">Last activity</dt>
            <dd className="text-right">{longAgo(row.updated)}</dd>
            <dt className="text-muted-foreground">Session</dt>
            <dd className="flex items-center justify-end gap-1 font-mono">
              <span className="truncate">{row.id.slice(0, 8)}</span>
              <button type="button" aria-label="Copy session id" className="text-muted-foreground hover:text-foreground" onClick={() => void navigator.clipboard.writeText(row.id)}>
                <CopyIcon className="size-3" />
              </button>
            </dd>
          </dl>
        </Section>
      ) : null}
      <DiffDialog cwd={cwd} open={diffOpen} onClose={() => setDiffOpen(false)} />
    </div>
  );
}

function ContextRow({ usage }: { usage: Usage }) {
  const used = usage.tokens !== undefined && usage.window > 0 ? Math.min(100, Math.round((usage.tokens / usage.window) * 100)) : null;
  const tick = usage.compactAt !== undefined && usage.window > 0 ? (usage.compactAt / usage.window) * 100 : null;
  return (
    <div className="flex flex-col gap-1.5 px-2.5 text-xs">
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">Context</span>
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full bg-primary/70", used !== null && used >= 90 ? "bg-destructive" : used !== null && used >= 80 ? "bg-warning" : null)}
            style={{ width: `${used ?? 0}%` }}
          />
          {tick !== null ? <div className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${tick}%` }} /> : null}
        </div>
        <span className="tabular-nums">
          {usage.tokens !== undefined ? compact(usage.tokens) : "—"}
          {usage.window > 0 ? ` / ${compact(usage.window)}` : ""}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{usage.billed ? "Cost" : "Estimated cost"}</span>
        <span className="tabular-nums">{dollars(usage.cost)}</span>
      </div>
      {usage.cacheSaved > 0 ? (
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Saved by the cache</span>
          <span className="tabular-nums">{dollars(usage.cacheSaved)}</span>
        </div>
      ) : null}
      {usage.compacting ? <p className="text-info-foreground">Compacting…</p> : null}
    </div>
  );
}

/** The folder's uncommitted changes, file by file. */
export function DiffDialog({ cwd, open, onClose }: { cwd: string; open: boolean; onClose: () => void }) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setFiles(null);
    setSelected(null);
    void invoke<ChangedFile[]>("git.changedFiles", { cwd }).then((list) => {
      setFiles(list);
      setSelected(list[0]?.path ?? null);
    });
  }, [open, cwd]);
  useEffect(() => {
    if (!open || !selected) return;
    setDiff(null);
    void invoke<string>("git.diff", { cwd, path: selected }).then(setDiff);
  }, [open, cwd, selected]);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPopup className="h-[80vh] max-w-5xl">
        <DialogHeader>
          <DialogTitle>Uncommitted changes</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 gap-0 border-t">
          <ul className="w-64 shrink-0 overflow-y-auto border-r p-1.5 text-xs">
            {files === null ? (
              <li className="flex justify-center p-3">
                <Spinner className="size-4" />
              </li>
            ) : files.length === 0 ? (
              <li className="p-3 text-muted-foreground">No changes.</li>
            ) : (
              files.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => setSelected(file.path)}
                    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent", selected === file.path && "bg-accent")}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>
                      {file.path}
                    </span>
                    <span className="shrink-0 font-mono text-diff-addition-foreground">+{file.added}</span>
                    <span className="shrink-0 font-mono text-diff-deletion-foreground">−{file.removed}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="min-w-0 flex-1 overflow-auto">
            {selected && diff === null ? (
              <div className="flex justify-center p-6">
                <Spinner className="size-4" />
              </div>
            ) : diff !== null ? (
              <DiffText text={diff} />
            ) : null}
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

export function DiffText({ text }: { text: string }) {
  if (!text.trim()) return <p className="p-4 text-xs text-muted-foreground">No textual changes (a binary file, or a new empty file).</p>;
  return (
    <pre className="min-w-max p-2 font-mono text-xs leading-5">
      {text.split("\n").map((line, index) => (
        <div
          key={index}
          className={cn(
            "px-2",
            line.startsWith("+") && !line.startsWith("+++") && "bg-diff-addition/15 text-diff-addition-foreground",
            line.startsWith("-") && !line.startsWith("---") && "bg-diff-deletion/15 text-diff-deletion-foreground",
            line.startsWith("@@") && "text-info-foreground",
            (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---")) && "text-muted-foreground",
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}
