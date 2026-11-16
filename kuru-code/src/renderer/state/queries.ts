import { useAtomValue } from "@effect/atom-react";
import { type VcsRefTarget } from "~/rt/state/vcs";
import type { VcsListRefsResult, VcsRef } from "~/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { isPaginatedBranchesNextPagePending } from "./paginatedBranches";
import { vcsEnvironment } from "./vcs";
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
import { findPaths, toPaths, type Paths } from "@panel/mentions";
import type { ComposerPathSearchTarget } from "~/rt/state/composerPathSearch";

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

// T3 Code's turn item detail: kuru code's projection has every item whole.
import type { OrchestrationV2GetTurnItemResult, ThreadId, TurnItemId } from "~/contracts";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";

/** Reads one item's detail from somewhere other than the environment, as the guest page does. */
export type TurnItemDetailSource = (input: {
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly revision: string;
}) => Atom.Atom<AsyncResult.AsyncResult<OrchestrationV2GetTurnItemResult, unknown>>;

export function useTurnItemDetail(
  target: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly itemId: TurnItemId;
    readonly revision: string;
  } | null,
  source?: TurnItemDetailSource,
) {
  const input =
    target === null ? null : { threadId: target.threadId, itemId: target.itemId, revision: target.revision };
  return useEnvironmentQuery<OrchestrationV2GetTurnItemResult, unknown>(
    target === null || input === null
      ? null
      : source
        ? source(input)
        : orchestrationEnvironment.turnItem({ environmentId: target.environmentId, input }),
  );
}

// From T3 Code's state/queries.ts: the branch picker's pages of refs.
const VCS_REF_LIST_LIMIT = 100;
const INITIAL_BRANCH_CURSORS = [undefined] as const;
const EMPTY_REFS: ReadonlyArray<VcsRef> = [];

function vcsRefPageAtom(targetKey: string, cursor: number | undefined) {
  const [environmentId, cwd, query] = JSON.parse(targetKey) as [EnvironmentId, string, string];
  return vcsEnvironment.listRefs({
    environmentId,
    input: {
      cwd,
      ...(query.length > 0 ? { query } : {}),
      ...(cursor === undefined ? {} : { cursor }),
      limit: VCS_REF_LIST_LIMIT,
    },
  });
}

const EMPTY_VCS_REF_PAGES_ATOM = Atom.make<
  ReadonlyArray<Atom.Type<ReturnType<typeof vcsRefPageAtom>>>
>([]).pipe(Atom.withLabel("web:vcs-ref-pages:empty"));

const vcsRefPagesAtom = Atom.family((pagesKey: string) => {
  const [targetKey, cursors] = JSON.parse(pagesKey) as [string, Array<number | null>];
  const pageAtoms = cursors.map((cursor) => vcsRefPageAtom(targetKey, cursor ?? undefined));
  return Atom.make((get) => pageAtoms.map((atom) => get(atom))).pipe(
    Atom.withLabel(`web:vcs-ref-pages:${pagesKey}`),
  );
});

export function usePaginatedBranches(target: VcsRefTarget) {
  // Leave unkeyed; mismatches already reset cursors, and a seeded key would break caching across the hook.
  const [pagination, setPagination] = useState<{
    readonly targetKey: string | null;
    readonly cursors: ReadonlyArray<number | undefined>;
  }>({
    targetKey: null,
    cursors: INITIAL_BRANCH_CURSORS,
  });
  const { environmentId, cwd } = target;
  const query = target.query?.trim() ?? "";
  const targetKey =
    environmentId !== null && cwd !== null ? JSON.stringify([environmentId, cwd, query]) : null;
  const cursors = pagination.targetKey === targetKey ? pagination.cursors : INITIAL_BRANCH_CURSORS;
  const pagesKey = targetKey === null ? null : JSON.stringify([targetKey, cursors]);
  const results = useAtomValue(
    pagesKey === null ? EMPTY_VCS_REF_PAGES_ATOM : vcsRefPagesAtom(pagesKey),
  );
  const values = results.flatMap((result) => {
    const value = AsyncResult.getOrElse(result, () => null);
    return value === null ? [] : [value];
  });
  const refs = new Map<string, VcsRef>();
  for (const value of values) {
    for (const ref of value.refs) {
      refs.set(ref.name, ref);
    }
  }
  const first = values[0] ?? null;
  const last = values.at(-1) ?? null;
  const data: VcsListRefsResult | null =
    first === null || last === null
      ? null
      : {
          refs: [...refs.values()],
          isRepo: first.isRepo,
          hasPrimaryRemote: first.hasPrimaryRemote,
          nextCursor: last.nextCursor,
          totalCount: Math.max(...values.map((value) => value.totalCount)),
        };
  const failed = results.find((result) => result._tag === "Failure");
  const isFetchingNextPage = isPaginatedBranchesNextPagePending(results);
  const error =
    failed?._tag === "Failure"
      ? (() => {
          const cause = Cause.squash(failed.cause);
          return cause instanceof Error && cause.message.trim().length > 0
            ? cause.message
            : "Failed to load refs.";
        })()
      : null;
  const refresh = () => {
    setPagination({ targetKey, cursors: INITIAL_BRANCH_CURSORS });
    if (targetKey !== null) {
      appAtomRegistry.refresh(vcsRefPageAtom(targetKey, undefined));
    }
  };
  const nextCursor = data?.nextCursor;
  const loadNext = () => {
    if (targetKey === null || nextCursor === null || nextCursor === undefined) {
      return;
    }
    setPagination((current) => {
      const currentCursors =
        current.targetKey === targetKey ? current.cursors : INITIAL_BRANCH_CURSORS;
      return currentCursors.includes(nextCursor)
        ? { targetKey, cursors: currentCursors }
        : { targetKey, cursors: [...currentCursors, nextCursor] };
    });
  };

  return {
    data,
    refs: data?.refs ?? EMPTY_REFS,
    error,
    isPending: results.some((result) => result.waiting),
    isFetchingNextPage,
    refresh,
    loadNext,
  };
}

// T3 Code's composer path search (state/queries.ts), over Unharnessed's `@` menu:
// the project's files from kuru code's main process (main/files.ts), ranked by the
// extension's own matcher (vscode/webview/mentions.tsx).
const PROJECT_PATH_SEARCH_DEBOUNCE_MS = 80;
const EMPTY_PROJECT_ENTRIES: ReadonlyArray<{ readonly path: string; readonly kind: "file" | "directory" }> = [];
const listedPaths = new Map<string, Promise<Paths>>();

function projectPaths(cwd: string): Promise<Paths> {
  let listed = listedPaths.get(cwd);
  if (!listed) {
    listed = invoke<{ files: string[]; open: string[] }>("files.list", { cwd }).then(({ files, open }) =>
      toPaths(files, open),
    );
    listedPaths.set(cwd, listed);
    // A menu opened later lists the folder again.
    window.setTimeout(() => listedPaths.delete(cwd), 30_000);
  }
  return listed;
}

export function useComposerPathSearch(target: ComposerPathSearchTarget) {
  const normalizedTarget = {
    environmentId: target.environmentId,
    cwd: target.cwd,
    query: target.query == null ? null : target.query.trim(),
  };
  const debouncedTarget = useDebouncedValue(normalizedTarget, PROJECT_PATH_SEARCH_DEBOUNCE_MS);
  const key =
    debouncedTarget.cwd === null || debouncedTarget.query === null
      ? null
      : `${debouncedTarget.cwd}\0${debouncedTarget.query}`;
  const [found, setFound] = useState<{
    key: string;
    entries: ReadonlyArray<{ readonly path: string; readonly kind: "file" | "directory" }>;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- lists the project's files in main and ranks them for the typed query
  useEffect(() => {
    if (key === null || debouncedTarget.cwd === null || debouncedTarget.query === null) return;
    let live = true;
    const query = debouncedTarget.query;
    void projectPaths(debouncedTarget.cwd).then(
      (paths) => {
        if (!live) return;
        const entries = findPaths(paths, query).map((path) =>
          path.endsWith("/")
            ? { path: path.slice(0, -1), kind: "directory" as const }
            : { path, kind: "file" as const },
        );
        setFound({ key, entries });
      },
      () => {
        if (live) setFound({ key, entries: EMPTY_PROJECT_ENTRIES });
      },
    );
    return () => {
      live = false;
    };
  }, [key, debouncedTarget.cwd, debouncedTarget.query]);
  const settled = found !== null && found.key === key;
  return {
    entries: settled ? found.entries : EMPTY_PROJECT_ENTRIES,
    error: null,
    isPending:
      normalizedTarget.cwd !== debouncedTarget.cwd ||
      normalizedTarget.query !== debouncedTarget.query ||
      (key !== null && !settled),
    searchedTarget: debouncedTarget,
    searchedQuery: debouncedTarget.query ?? "",
    truncated: false,
  };
}
