import {
  ArrowDownToLineIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CloudUploadIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  PlusIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Branch, ChangedFile, GitAction, GitActionRequest, GitActionResult, GitStatus } from "@shared/git";
import { invoke } from "~/bridge";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "./ui/menu";
import { Spinner } from "./ui/spinner";
import { Textarea } from "./ui/textarea";
import { toastManager } from "./ui/toast";

type Repo = Extract<GitStatus, { repo: true }>;

/** What the main button does now, as T3 Code's git control picks it. */
type Primary =
  | { kind: "commit"; label: string }
  | { kind: "action"; action: GitAction; label: string }
  | { kind: "pr"; label: string; url: string }
  | null;

function primaryOf(status: Repo): Primary {
  if (status.changedFiles > 0) return { kind: "commit", label: "Commit" };
  if (status.behind > 0 && status.ahead === 0) return { kind: "action", action: "pull", label: "Pull" };
  if (status.hasRemote && (status.ahead > 0 || (!status.upstream && status.aheadOfDefault > 0))) return { kind: "action", action: "push", label: "Push" };
  if (status.pr) return { kind: "pr", label: `#${status.pr.number}`, url: status.pr.url };
  if (status.github && status.branch && status.branch !== status.defaultBranch && status.aheadOfDefault > 0 && status.upstream)
    return { kind: "action", action: "create_pr", label: "Create PR" };
  return null;
}

export async function runGit(request: GitActionRequest): Promise<boolean> {
  const id = toastManager.add({ type: "loading", title: gitProgressLabel(request.action), timeout: 0 });
  try {
    const result = await invoke<GitActionResult>("git.act", request);
    toastManager.close(id);
    if (result.ok) {
      toastManager.add({
        type: "success",
        title: result.summary,
        ...(result.prUrl
          ? { actionProps: { children: "Open PR", onClick: () => void invoke("shell.openExternal", { url: result.prUrl }) } }
          : {}),
      });
      return true;
    }
    toastManager.add({ type: "error", title: "Git action failed", description: result.error });
  } catch (error) {
    toastManager.close(id);
    toastManager.add({ type: "error", title: "Git action failed", description: String(error) });
  }
  return false;
}

function gitProgressLabel(action: GitAction): string {
  switch (action) {
    case "commit":
      return "Committing…";
    case "push":
      return "Pushing…";
    case "commit_push":
      return "Committing and pushing…";
    case "commit_push_pr":
      return "Committing, pushing and opening a pull request…";
    case "create_pr":
      return "Opening a pull request…";
    case "pull":
      return "Pulling…";
  }
}

/** The header's git control: the next step as a button, every step in its menu. */
export function GitActionsControl({ cwd, status, refresh }: { cwd: string; status: GitStatus | null; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [commitOpen, setCommitOpen] = useState<GitAction | null>(null);
  if (!status) return null;
  if (!status.repo) {
    return (
      <Button
        size="xs"
        variant="outline"
        onClick={async () => {
          const error = await invoke<string | null>("git.init", { cwd });
          if (error) toastManager.add({ type: "error", title: "Could not initialize git", description: error });
          void refresh();
        }}
      >
        <GitBranchIcon />
        Initialize git
      </Button>
    );
  }
  const primary = primaryOf(status);
  const run = async (action: GitAction) => {
    setBusy(true);
    await runGit({ cwd, action });
    setBusy(false);
    void refresh();
  };
  const onPrimary = () => {
    if (!primary) return;
    if (primary.kind === "commit") setCommitOpen("commit");
    else if (primary.kind === "pr") void invoke("shell.openExternal", { url: primary.url });
    else void run(primary.action);
  };
  const changes = status.changedFiles > 0;
  return (
    <>
      <div className="flex items-center">
        {primary ? (
          <Button size="xs" variant="outline" className="rounded-r-none" disabled={busy} onClick={onPrimary}>
            {busy ? (
              <Spinner className="size-3.5" />
            ) : primary.kind === "commit" ? (
              <GitCommitHorizontalIcon />
            ) : primary.kind === "pr" ? (
              <GitPullRequestIcon />
            ) : primary.action === "pull" ? (
              <ArrowDownToLineIcon />
            ) : primary.action === "push" ? (
              <ArrowUpIcon />
            ) : (
              <GitPullRequestIcon />
            )}
            {primary.label}
            {primary.kind === "action" && primary.action === "push" && status.ahead > 0 ? <span className="text-muted-foreground tabular-nums">{status.ahead}</span> : null}
          </Button>
        ) : null}
        <Menu>
          <MenuTrigger
            render={
              <Button size={primary ? "icon-xs" : "xs"} variant="outline" aria-label="Git actions" className={cn(primary && "-ml-px rounded-l-none")} disabled={busy} />
            }
          >
            {primary ? null : (
              <>
                <GitBranchIcon />
                Git
              </>
            )}
            <ChevronDownIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem disabled={!changes} onClick={() => setCommitOpen("commit")}>
              <GitCommitHorizontalIcon />
              Commit…
            </MenuItem>
            <MenuItem disabled={!changes || !status.hasRemote} onClick={() => setCommitOpen("commit_push")}>
              <CloudUploadIcon />
              Commit & push…
            </MenuItem>
            <MenuItem disabled={!changes || !status.github || !!status.pr} onClick={() => setCommitOpen("commit_push_pr")}>
              <GitPullRequestIcon />
              Commit, push & create PR…
            </MenuItem>
            <MenuSeparator />
            <MenuItem disabled={!status.hasRemote || (status.ahead === 0 && !!status.upstream)} onClick={() => void run("push")}>
              <ArrowUpIcon />
              Push{status.ahead > 0 ? ` ${status.ahead} commit${status.ahead === 1 ? "" : "s"}` : ""}
            </MenuItem>
            <MenuItem disabled={!status.upstream} onClick={() => void run("pull")}>
              <ArrowDownToLineIcon />
              Pull{status.behind > 0 ? ` ${status.behind} commit${status.behind === 1 ? "" : "s"}` : ""}
            </MenuItem>
            <MenuItem disabled={!status.github || !!status.pr || status.branch === status.defaultBranch} onClick={() => setCommitOpen("create_pr")}>
              <GitPullRequestIcon />
              Create pull request…
            </MenuItem>
            {status.pr ? (
              <MenuItem onClick={() => void invoke("shell.openExternal", { url: status.pr!.url })}>
                <ExternalLinkIcon />
                Open PR #{status.pr.number} on GitHub
              </MenuItem>
            ) : status.github ? (
              <MenuItem onClick={() => void invoke("shell.openExternal", { url: `https://github.com/${status.github}` })}>
                <ExternalLinkIcon />
                Open on GitHub
              </MenuItem>
            ) : null}
          </MenuPopup>
        </Menu>
      </div>
      <CommitDialog
        cwd={cwd}
        status={status}
        action={commitOpen}
        onClose={() => setCommitOpen(null)}
        onDone={() => {
          setCommitOpen(null);
          void refresh();
        }}
      />
    </>
  );
}

/** Commit (then push, then a pull request): the message, written by the agent when left empty. */
function CommitDialog({
  cwd,
  status,
  action,
  onClose,
  onDone,
}: {
  cwd: string;
  status: Repo;
  action: GitAction | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [message, setMessage] = useState("");
  const [branch, setBranch] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const open = action !== null;
  const commits = action === "commit" || action === "commit_push" || action === "commit_push_pr";
  const opensPr = action === "commit_push_pr" || action === "create_pr";
  const onDefault = status.branch !== null && status.branch === status.defaultBranch;

  useEffect(() => {
    if (!open) return;
    setMessage("");
    setBranch("");
    setPrTitle("");
    setPrBody("");
    setDraft(false);
    setFiles(null);
    if (commits) void invoke<ChangedFile[]>("git.changedFiles", { cwd }).then(setFiles);
  }, [open]);

  const submit = async () => {
    if (!action) return;
    setBusy(true);
    const ok = await runGit({
      cwd,
      action,
      message: message.trim() || undefined,
      newBranch: branch.trim() || undefined,
      prTitle: prTitle.trim() || undefined,
      prBody,
      draft,
    });
    setBusy(false);
    if (ok) onDone();
  };
  const title = action === "create_pr" ? "Create pull request" : action === "commit_push_pr" ? "Commit, push & create PR" : action === "commit_push" ? "Commit & push" : "Commit changes";
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {status.branch ? (
              <span className="inline-flex items-center gap-1">
                <GitBranchIcon className="size-3.5" />
                <span className="font-mono">{status.branch}</span>
              </span>
            ) : (
              "Detached HEAD"
            )}
            {commits ? ` · ${status.changedFiles} changed file${status.changedFiles === 1 ? "" : "s"}` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {commits ? (
            <>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Commit message</span>
                <Textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Leave empty to have the agent write one from the changes"
                  rows={4}
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit();
                  }}
                />
              </label>
              {files && files.length > 0 ? (
                <ul className="max-h-40 overflow-auto rounded-lg border bg-muted/40 p-1.5 font-mono text-xs">
                  {files.map((file) => (
                    <li key={file.path} className="flex items-center gap-2 px-1.5 py-0.5">
                      <span className="w-4 shrink-0 text-muted-foreground">{file.status}</span>
                      <span className="min-w-0 flex-1 truncate">{file.path}</span>
                      <span className="text-diff-addition-foreground">+{file.added}</span>
                      <span className="text-diff-deletion-foreground">−{file.removed}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {onDefault ? (
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">
                    New branch <span className="font-normal text-muted-foreground">(optional, instead of committing to {status.branch})</span>
                  </span>
                  <Input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="feature/my-change" />
                </label>
              ) : null}
            </>
          ) : null}
          {opensPr ? (
            <>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">
                  Pull request title <span className="font-normal text-muted-foreground">(empty: from the commits)</span>
                </span>
                <Input value={prTitle} onChange={(event) => setPrTitle(event.target.value)} />
              </label>
              {prTitle.trim() ? (
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Description</span>
                  <Textarea value={prBody} onChange={(event) => setPrBody(event.target.value)} rows={4} />
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={draft} onCheckedChange={(checked) => setDraft(checked === true)} />
                Open as draft
              </label>
            </>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner className="size-3.5" /> : <CheckIcon />}
            {title}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** The thread's branch, and the others to switch to or a new one. */
export function BranchPicker({ cwd, status, refresh }: { cwd: string; status: Repo; refresh: () => Promise<void> }) {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    void invoke<Branch[]>("git.branches", { cwd }).then(setBranches);
  }, [open, cwd]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (branches ?? []).filter((branch) => !needle || branch.name.toLowerCase().includes(needle)).slice(0, 60);
  }, [branches, query]);
  const checkout = async (name: string, create: boolean) => {
    setOpen(false);
    const error = await invoke<string | null>("git.checkout", { cwd, branch: name, create });
    if (error) toastManager.add({ type: "error", title: `Could not switch to ${name}`, description: error });
    void refresh();
  };
  const exact = (branches ?? []).some((branch) => branch.name === query.trim());
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger render={<Button variant="ghost" size="sm" className="w-full justify-start gap-2 px-2.5 font-normal" />}>
        <GitBranchIcon className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-left font-mono text-xs">{status.branch ?? "detached HEAD"}</span>
        <ChevronDownIcon className="text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-72">
        <div className="px-1 pb-1">
          <Input
            size="sm"
            value={query}
            autoFocus
            placeholder="Switch or create a branch"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter" && query.trim()) void checkout(query.trim(), !exact);
            }}
          />
        </div>
        {branches === null ? (
          <div className="flex justify-center p-3">
            <Spinner className="size-4" />
          </div>
        ) : null}
        {shown.map((branch) => (
          <MenuItem key={`${branch.remote}:${branch.name}`} onClick={() => !branch.current && void checkout(branch.name, false)}>
            {branch.current ? <CheckIcon /> : <GitBranchIcon />}
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{branch.name}</span>
            {branch.remote ? <span className="text-2xs text-muted-foreground">remote</span> : null}
          </MenuItem>
        ))}
        {query.trim() && !exact ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => void checkout(query.trim(), true)}>
              <PlusIcon />
              Create branch <span className="font-mono text-xs">{query.trim()}</span>
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
