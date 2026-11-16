// Adapted from T3 Code's state/queries.ts: the sidebar's thread search over
// message text. T3 Code asks each environment's server; kuru code asks its
// main process, which reads the session files (main/search.ts).
import { useEffect, useState } from "react";
import { LOCAL_ENVIRONMENT_ID, type EnvironmentId, type ProjectId } from "~/contracts";
import {
  visibleThreadSearch,
  type EnvironmentThreadSearchMatch,
  type SettledThreadSearch,
} from "~/rt/state/threadSearch";
import { messageSearchTokens } from "~/shared/paletteSearch";
import { invoke } from "~/bridge";

const THREAD_SEARCH_DEBOUNCE_MS = 120;
const THREAD_SEARCH_QUERY_MAX_LENGTH = 200;
const EMPTY_THREAD_SEARCH_MATCHES: ReadonlyArray<EnvironmentThreadSearchMatch> = [];

export interface ThreadSearchScope {
  readonly projectIds?: ReadonlyArray<ProjectId>;
  readonly titlesOnly?: boolean;
}

export function useDebouncedValue<A>(value: A, delayMs: number): A {
  const [debounced, setDebounced] = useState(value);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounce timer that publishes the value after delayMs
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [delayMs, value]);
  return debounced;
}

type SearchState = { key: string; matches: ReadonlyArray<EnvironmentThreadSearchMatch> | null };

export function useThreadSearch(
  environmentIds: ReadonlyArray<EnvironmentId>,
  query: string,
  scope: ThreadSearchScope = {},
): {
  readonly matches: ReadonlyArray<EnvironmentThreadSearchMatch>;
  readonly query: string;
  readonly isPending: boolean;
} {
  const normalizedQuery = query.trim().slice(0, THREAD_SEARCH_QUERY_MAX_LENGTH).trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, THREAD_SEARCH_DEBOUNCE_MS);
  const canSearch =
    environmentIds.length > 0 &&
    scope.titlesOnly !== true &&
    messageSearchTokens(normalizedQuery).long.length > 0;
  const settledQuery = canSearch && normalizedQuery === debouncedQuery ? debouncedQuery : null;
  const projectIds = scope.projectIds ?? null;
  const searchKey =
    settledQuery === null ? null : JSON.stringify([settledQuery, projectIds ?? null]);
  const [state, setState] = useState<SearchState | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the main process for the settled query's matches
  useEffect(() => {
    if (searchKey === null || settledQuery === null) return;
    let cancelled = false;
    setState({ key: searchKey, matches: null });
    void invoke<ReadonlyArray<Omit<EnvironmentThreadSearchMatch, "environmentId">>>(
      "threads.search",
      { query: settledQuery, projectIds },
    )
      .catch(() => [])
      .then((matches) => {
        if (cancelled) return;
        setState({
          key: searchKey,
          matches: matches.map(
            (match) => ({ ...match, environmentId: LOCAL_ENVIRONMENT_ID }) as EnvironmentThreadSearchMatch,
          ),
        });
      });
    return () => {
      cancelled = true;
    };
    // projectIds is part of searchKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);
  const loading = searchKey !== null && (state?.key !== searchKey || state.matches === null);
  const isPending = canSearch && (normalizedQuery !== debouncedQuery || loading);
  const ready: SettledThreadSearch | null =
    settledQuery !== null && state?.key === searchKey && state.matches !== null
      ? { query: settledQuery, matches: state.matches }
      : null;
  const [previous, setPrevious] = useState<SettledThreadSearch | null>(null);
  if (ready !== null && previous?.matches !== ready.matches) setPrevious(ready);
  const visible = canSearch
    ? visibleThreadSearch(normalizedQuery, ready, previous)
    : { query: "", matches: EMPTY_THREAD_SEARCH_MATCHES };
  return { matches: visible.matches, query: visible.query, isPending };
}
