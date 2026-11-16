import { ChartNoAxesColumnIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProviderLimits, UsageReport, UsageTotals } from "@shared/usage";
import { invoke } from "~/bridge";
import { cn } from "~/lib/utils";
import { compact, dollars } from "~/lib/format";
import { useNow } from "~/hooks/useNow";
import { set } from "~/state";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { WorkspaceHeader } from "./WorkspaceHeader";

const PERIODS = [7, 30, 90] as const;
type Metric = "cost" | "tokens";

const tokensOf = (totals: UsageTotals) => totals.input + totals.output + totals.cacheRead + totals.cacheWrite;

/** T3 Code's Usage page: what the threads cost and used, and the subscriptions' limits. */
export function UsagePage() {
  const [days, setDays] = useState<number>(30);
  const [metric, setMetric] = useState<Metric>("cost");
  const [report, setReport] = useState<UsageReport | null>(null);
  const [limits, setLimits] = useState<ProviderLimits[] | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const [nextReport, nextLimits] = await Promise.all([
      invoke<UsageReport>("usage.get", { days }).catch(() => null),
      invoke<ProviderLimits[]>("limits.get").catch(() => []),
    ]);
    setReport(nextReport);
    setLimits(nextLimits);
    setLoading(false);
  }, [days]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && set({ usageOpen: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspaceHeader>
        <h1 className="text-sm font-medium">Usage</h1>
        <div className="flex-1" />
        <Button size="icon-sm" variant="ghost" aria-label="Refresh" disabled={loading} onClick={() => void load()}>
          <RefreshCwIcon className={cn(loading && "animate-spin")} />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => set({ usageOpen: false })}>
          <XIcon />
        </Button>
      </WorkspaceHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-6">
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup value={[String(days)]} onValueChange={(value) => value[0] && setDays(Number(value[0]))}>
              {PERIODS.map((period) => (
                <ToggleGroupItem key={period} value={String(period)}>
                  {period} days
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="flex-1" />
            <ToggleGroup value={[metric]} onValueChange={(value) => value[0] && setMetric(value[0] as Metric)}>
              <ToggleGroupItem value="cost">Cost</ToggleGroupItem>
              <ToggleGroupItem value="tokens">Tokens</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {limits && limits.length > 0 ? <LimitsSection limits={limits} /> : null}
          {report === null ? (
            <div className="flex justify-center p-10">{loading ? <Spinner className="size-5" /> : <p className="text-sm text-muted-foreground">Usage could not be read.</p>}</div>
          ) : (
            <Report report={report} metric={metric} />
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {detail ? <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function Report({ report, metric }: { report: UsageReport; metric: Metric }) {
  const value = (totals: UsageTotals) => (metric === "cost" ? totals.cost : tokensOf(totals));
  const format = (n: number) => (metric === "cost" ? dollars(n) : compact(n));
  const max = Math.max(...report.daily.map(value), 0);
  const total = value(report.totals);
  if (report.totals.replies === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
        <ChartNoAxesColumnIcon className="size-6" />
        No replies in the last {report.days} days.
      </div>
    );
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="Cost" value={dollars(report.totals.cost)} detail={`${report.totals.replies.toLocaleString()} replies`} />
        <Card label="Threads" value={report.sessions.toLocaleString()} />
        <Card label="Input tokens" value={compact(report.totals.input + report.totals.cacheRead + report.totals.cacheWrite)} detail={`${compact(report.totals.cacheRead)} from the cache`} />
        <Card label="Output tokens" value={compact(report.totals.output)} />
      </div>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">By day</h2>
        <div className="flex h-40 items-end gap-[2px]">
          {report.daily.map((day) => {
            const height = max > 0 ? (value(day) / max) * 100 : 0;
            return (
              <Tooltip key={day.day}>
                <TooltipTrigger render={<div className="flex h-full min-w-0 flex-1 items-end" />}>
                  <div className={cn("w-full rounded-t-sm bg-primary/70 hover:bg-primary", height === 0 && "bg-muted")} style={{ height: `${Math.max(height, 1.5)}%` }} />
                </TooltipTrigger>
                <TooltipPopup>
                  {new Date(`${day.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: {format(value(day))}
                </TooltipPopup>
              </Tooltip>
            );
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-2xs text-muted-foreground">
          <span>{report.daily[0]?.day}</span>
          <span>{report.daily.at(-1)?.day}</span>
        </div>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown
          title="By provider"
          rows={report.providers.map((row) => ({ key: row.provider, label: row.provider, value: value(row), detail: `${row.sessions} thread${row.sessions === 1 ? "" : "s"}` }))}
          total={total}
          format={format}
        />
        <Breakdown
          title="By model"
          rows={report.models.map((row) => ({ key: row.key, label: row.model, sub: row.provider, value: value(row), detail: `${row.replies} replies` }))}
          total={total}
          format={format}
        />
      </div>
    </>
  );
}

function Breakdown({
  title,
  rows,
  total,
  format,
}: {
  title: string;
  rows: { key: string; label: string; sub?: string; value: number; detail: string }[];
  total: number;
  format: (n: number) => string;
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.value - a.value), [rows]);
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      <ul className="flex flex-col gap-2.5">
        {sorted.map((row) => {
          const share = total > 0 ? (row.value / total) * 100 : 0;
          return (
            <li key={row.key} className="text-xs">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {row.label}
                  {row.sub ? <span className="ml-1.5 font-normal text-muted-foreground">{row.sub}</span> : null}
                </span>
                <span className="shrink-0 tabular-nums">{format(row.value)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${share}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right text-muted-foreground">{row.detail}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function resetIn(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((ms - now) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function LimitsSection({ limits }: { limits: ProviderLimits[] }) {
  const now = useNow(30_000);
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium">Usage limits</h2>
      <div className="flex flex-col gap-4">
        {limits.map((provider) => (
          <div key={provider.provider}>
            <div className="mb-1.5 text-xs font-medium">{provider.name}</div>
            {provider.error ? <p className="text-xs text-muted-foreground">{provider.error}</p> : null}
            <div className="grid grid-cols-[auto_minmax(4rem,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-xs">
              {provider.windows.map((window) => {
                const used = Math.round(Math.max(0, Math.min(100, window.usedPercent)));
                return (
                  <div key={window.label} className="contents">
                    <span className="text-muted-foreground">{window.label}</span>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full", used >= 90 ? "bg-destructive" : used >= 75 ? "bg-warning" : "bg-primary/70")} style={{ width: `${used}%` }} />
                    </div>
                    <span className="tabular-nums">
                      {used}%{window.resetsAt ? <span className="text-muted-foreground"> · resets in {resetIn(window.resetsAt, now)}</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
