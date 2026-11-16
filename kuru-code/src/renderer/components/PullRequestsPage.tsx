import {
  CheckIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  SearchIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PullRequestDetail, PullRequestListItem } from "@shared/git";
import { Markdown } from "@panel/Markdown";
import { invoke, post } from "~/bridge";
import { cn } from "~/lib/utils";
import { longAgo } from "~/lib/format";
import { set, useStore } from "~/state";
import { DiffText } from "./ThreadDetails";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Spinner } from "./ui/spinner";
import { Textarea } from "./ui/textarea";
import { toastManager } from "./ui/toast";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { WorkspaceHeader } from "./WorkspaceHeader";

type State = "open" | "closed" | "merged" | "all";
type List = { items: PullRequestListItem[]; me: string | null; errors: string[] };

export function PrStateIcon({ pr, className }: { pr: Pick<PullRequestListItem, "state" | "draft">; className?: string }) {
  if (pr.state === "merged") return <GitMergeIcon className={cn("text-violet-500", className)} />;
  if (pr.state === "closed") return <GitPullRequestClosedIcon className={cn("text-destructive-foreground", className)} />;
  if (pr.draft) return <GitPullRequestDraftIcon className={cn("text-muted-foreground", className)} />;
  return <GitPullRequestIcon className={cn("text-success-foreground", className)} />;
}

function Checks({ checks }: { checks: PullRequestListItem["checks"] }) {
  if (!checks) return null;
  if (checks === "success") return <CheckIcon aria-label="Checks passed" className="size-3.5 text-success-foreground" />;
  if (checks === "failure") return <XIcon aria-label="Checks failed" className="size-3.5 text-destructive-foreground" />;
  return <CircleDotIcon aria-label="Checks running" className="size-3.5 text-warning-foreground" />;
}

/** The projects' pull requests on GitHub, grouped as T3 Code does: yours to review, yours, the rest. */
export function PullRequestsPage() {
  const main = useStore((state) => state.main);
  const projects = useStore((state) => state.app?.projects ?? []);
  const selected = main.kind === "prs" ? main.selected : undefined;
  const [state, setState] = useState<State>("open");
  const [list, setList] = useState<List | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await invoke<List>("prs.list", { state }));
    } catch (error) {
      setList({ items: [], me: null, errors: [String(error)] });
    }
    setLoading(false);
  }, [state]);
  useEffect(() => {
    void load();
  }, [load, projects.length]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items = (list?.items ?? [])
      .filter((pr) => !needle || pr.title.toLowerCase().includes(needle) || `${pr.repo}#${pr.number}`.toLowerCase().includes(needle) || pr.author.login.toLowerCase().includes(needle))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const me = list?.me?.toLowerCase();
    const review = items.filter((pr) => pr.reviewRequested);
    const mine = items.filter((pr) => !pr.reviewRequested && me && pr.author.login.toLowerCase() === me);
    const rest = items.filter((pr) => !review.includes(pr) && !mine.includes(pr));
    return [
      { title: "Review requested", items: review },
      { title: "Yours", items: mine },
      { title: me ? "Others" : "Pull requests", items: rest },
    ].filter((group) => group.items.length > 0);
  }, [list, query]);

  const select = (pr: PullRequestListItem) => set({ main: { kind: "prs", selected: { repo: pr.repo, number: pr.number } } });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspaceHeader>
        <h1 className="text-sm font-medium">Pull requests</h1>
        <div className="flex-1" />
        <Button size="icon-sm" variant="ghost" aria-label="Refresh" onClick={() => void load()} disabled={loading}>
          <RefreshCwIcon className={cn(loading && "animate-spin")} />
        </Button>
      </WorkspaceHeader>
      <div className="flex min-h-0 flex-1">
        <div className={cn("flex min-h-0 flex-col border-r border-border/60", selected ? "w-[26rem] shrink-0" : "flex-1")}>
          <div className="flex items-center gap-2 px-4 py-2.5">
            <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2.5">
              <SearchIcon className="size-3.5 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter pull requests" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70" />
            </div>
            <ToggleGroup value={[state]} onValueChange={(value) => value[0] && setState(value[0] as State)}>
              {(["open", "merged", "closed", "all"] as const).map((value) => (
                <ToggleGroupItem key={value} value={value} className="capitalize">
                  {value}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {list?.errors.map((error) => (
              <p key={error} className="mx-2 mb-2 rounded-md bg-error-surface px-3 py-2 text-xs text-destructive-foreground">
                {error}
              </p>
            ))}
            {list === null ? (
              <div className="flex justify-center p-8">
                <Spinner className="size-5" />
              </div>
            ) : groups.length === 0 ? (
              <Empty className="py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <GitPullRequestIcon />
                  </EmptyMedia>
                  <EmptyTitle>No pull requests</EmptyTitle>
                  <EmptyDescription>
                    {projects.length === 0 ? "Add a project cloned from GitHub to see its pull requests." : "None of your projects' GitHub repositories has one in this state."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              groups.map((group) => (
                <section key={group.title} className="mb-3">
                  <h2 className="px-2.5 py-1.5 text-2xs font-medium text-muted-foreground">
                    {group.title} <span className="tabular-nums">{group.items.length}</span>
                  </h2>
                  <ul className="flex flex-col gap-px">
                    {group.items.map((pr) => {
                      const active = selected?.repo === pr.repo && selected.number === pr.number;
                      return (
                        <li key={`${pr.repo}#${pr.number}`}>
                          <button
                            type="button"
                            onClick={() => select(pr)}
                            className={cn("flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-accent", active && "bg-accent")}
                          >
                            <PrStateIcon pr={pr} className="mt-0.5 size-4 shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">{pr.title}</span>
                                <Checks checks={pr.checks} />
                              </span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span className="truncate">
                                  {pr.repo}#{pr.number}
                                </span>
                                <span>·</span>
                                <span className="truncate">{pr.author.login}</span>
                                <span>·</span>
                                <span className="shrink-0">{longAgo(pr.updatedAt)}</span>
                                <span className="ml-auto shrink-0 font-mono">
                                  <span className="text-diff-addition-foreground">+{pr.additions}</span> <span className="text-diff-deletion-foreground">−{pr.deletions}</span>
                                </span>
                              </span>
                              {pr.labels.length > 0 && !selected ? (
                                <span className="mt-1 flex flex-wrap gap-1">
                                  {pr.labels.map((label) => (
                                    <span key={label.name} className="rounded-full border px-1.5 text-2xs" style={{ borderColor: `#${label.color}80`, color: `#${label.color}` }}>
                                      {label.name}
                                    </span>
                                  ))}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
        </div>
        {selected ? <PullRequestDetailPanel key={`${selected.repo}#${selected.number}`} repo={selected.repo} number={selected.number} /> : null}
      </div>
    </div>
  );
}

type Tab = "summary" | "files" | "commits" | "checks";

function PullRequestDetailPanel({ repo, number }: { repo: string; number: number }) {
  const [detail, setDetail] = useState<PullRequestDetail | string | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [diff, setDiff] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const load = useCallback(() => void invoke<PullRequestDetail | string>("prs.get", { repo, number }).then(setDetail), [repo, number]);
  useEffect(load, [load]);
  useEffect(() => {
    if (tab === "files" && diff === null) void invoke<string>("prs.diff", { repo, number }).then(setDiff);
  }, [tab, diff, repo, number]);

  if (detail === null)
    return (
      <div className="flex flex-1 justify-center p-10">
        <Spinner className="size-5" />
      </div>
    );
  if (typeof detail === "string") return <p className="flex-1 p-6 text-sm text-destructive-foreground">{detail}</p>;

  const checkout = async (review: boolean) => {
    const result = await invoke<{ error: string } | { cwd: string; projectId: string }>("prs.checkout", { repo, number });
    if ("error" in result) {
      toastManager.add({ type: "error", title: "Could not check out the pull request", description: result.error });
      return;
    }
    toastManager.add({ type: "success", title: `Checked out #${number} (${detail.headRefName})` });
    if (review) {
      set({ main: { kind: "thread" } });
      post({
        type: "newChat",
        projectId: result.projectId,
        draft: { text: `Review pull request #${number} (${detail.title}) of ${repo}: its branch ${detail.headRefName} is checked out. Read the diff against ${detail.baseRefName} and report problems, risks and suggestions.`, images: [] },
      });
    }
  };
  const send = async () => {
    if (!comment.trim()) return;
    setSending(true);
    const error = await invoke<string | null>("prs.comment", { repo, number, body: comment });
    setSending(false);
    if (error) toastManager.add({ type: "error", title: "Comment not sent", description: error });
    else {
      setComment("");
      load();
    }
  };
  const timeline = [
    ...detail.comments.map((item) => ({ kind: "comment" as const, author: item.author, body: item.body, at: item.createdAt, state: "" })),
    ...detail.reviews.filter((review) => review.body.trim() || review.state !== "COMMENTED").map((item) => ({ kind: "review" as const, author: item.author, body: item.body, at: item.submittedAt, state: item.state })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-b border-border/60 px-6 pt-5 pb-3">
        <div className="flex items-start gap-3">
          <h2 className="min-w-0 flex-1 text-lg font-semibold leading-snug">
            {detail.title} <span className="font-normal text-muted-foreground">#{detail.number}</span>
          </h2>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => set({ main: { kind: "prs" } })}>
            <XIcon />
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={detail.state === "open" ? "success" : detail.state === "merged" ? "info" : "error"} className="capitalize">
            <PrStateIcon pr={detail} className="size-3" />
            {detail.draft && detail.state === "open" ? "Draft" : detail.state}
          </Badge>
          <span>
            <span className="font-medium text-foreground">{detail.author.login}</span> wants to merge
          </span>
          <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 font-mono">
            <GitBranchIcon className="size-3" />
            {detail.headRefName}
          </span>
          <span>into</span>
          <span className="rounded bg-muted px-1.5 font-mono">{detail.baseRefName}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="xs" variant="outline" onClick={() => void invoke("shell.openExternal", { url: detail.url })}>
            <ExternalLinkIcon />
            Open on GitHub
          </Button>
          {detail.state === "open" ? (
            <>
              <Button size="xs" variant="outline" onClick={() => void checkout(false)}>
                <GitBranchIcon />
                Check out
              </Button>
              <Button size="xs" onClick={() => void checkout(true)}>
                <SquarePenIcon />
                Review in a thread
              </Button>
            </>
          ) : null}
        </div>
        <div className="mt-4 flex gap-4 text-sm">
          {(
            [
              ["summary", "Summary"],
              ["files", `Files ${detail.files.length}`],
              ["commits", `Commits ${detail.commits.length}`],
              ["checks", `Checks ${detail.checkRuns.length}`],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={cn("-mb-3 border-b-2 pb-2 text-muted-foreground hover:text-foreground", tab === id ? "border-primary text-foreground" : "border-transparent")}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "summary" ? (
          <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-5">
            <article className="rounded-lg border bg-card p-4 text-sm">{detail.body.trim() ? <Markdown text={detail.body} /> : <p className="text-muted-foreground italic">No description.</p>}</article>
            {timeline.map((item, index) => (
              <article key={index} className="rounded-lg border bg-card text-sm">
                <header className="flex items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
                  <MessageSquareIcon className="size-3.5" />
                  <span className="font-medium text-foreground">{item.author}</span>
                  {item.kind === "review" ? <span>{item.state.toLowerCase().replace(/_/g, " ")}</span> : <span>commented</span>}
                  <span className="ml-auto">{longAgo(item.at)}</span>
                </header>
                {item.body.trim() ? (
                  <div className="px-4 py-3">
                    <Markdown text={item.body} />
                  </div>
                ) : null}
              </article>
            ))}
            <div className="flex flex-col gap-2">
              <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Leave a comment" rows={3} />
              <Button size="sm" className="self-end" disabled={!comment.trim() || sending} onClick={() => void send()}>
                {sending ? <Spinner className="size-3.5" /> : null}
                Comment
              </Button>
            </div>
          </div>
        ) : tab === "files" ? (
          diff === null ? (
            <div className="flex justify-center p-8">
              <Spinner className="size-5" />
            </div>
          ) : (
            <DiffText text={diff} />
          )
        ) : tab === "commits" ? (
          <ul className="mx-auto max-w-3xl px-6 py-4 text-sm">
            {detail.commits.map((commit) => (
              <li key={commit.oid} className="flex items-center gap-3 border-b py-2 last:border-0">
                <span className="font-mono text-xs text-muted-foreground">{commit.oid.slice(0, 7)}</span>
                <span className="min-w-0 flex-1 truncate">{commit.headline}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {commit.author} · {longAgo(commit.committedDate)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="mx-auto max-w-3xl px-6 py-4 text-sm">
            {detail.checkRuns.length === 0 ? <li className="text-muted-foreground">No checks.</li> : null}
            {detail.checkRuns.map((check, index) => (
              <li key={index} className="flex items-center gap-3 border-b py-2 last:border-0">
                {check.conclusion === "SUCCESS" || check.status === "SUCCESS" ? (
                  <CheckIcon className="size-4 text-success-foreground" />
                ) : check.conclusion && check.conclusion !== "NEUTRAL" && check.conclusion !== "SKIPPED" ? (
                  <XIcon className="size-4 text-destructive-foreground" />
                ) : (
                  <CircleDotIcon className="size-4 text-warning-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{check.name}</span>
                <span className="text-xs text-muted-foreground lowercase">{check.conclusion ?? check.status}</span>
                {check.url ? (
                  <Button size="icon-xs" variant="ghost-muted" aria-label="Open" onClick={() => void invoke("shell.openExternal", { url: check.url })}>
                    <ExternalLinkIcon />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
