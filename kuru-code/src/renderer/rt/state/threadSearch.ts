// Adapted from T3 Code's client-runtime state/threadSearch.ts: thread search's
// ranking. T3 Code searches messages on its server; kuru code's main process
// searches the Unharnessed session files (kuru/threadSearch.ts), so the
// server query atoms are gone.
import type { EnvironmentId, MessageId, ProjectId, ThreadId } from "~/contracts";
import {
  foldSearchQuery,
  THREAD_OPEN_DEDUPE_MS,
  type ThreadSearchSubject,
} from "~/shared/paletteSearch";
import { threadSearchPullRequests } from "~/shared/threadPullRequests";

import type { EnvironmentThreadShell } from "./models";
import { getThreadSortTimestamp } from "./threadSort";

/** A message that matches a search, from T3 Code's contracts threadSearch.ts. */
export interface OrchestrationThreadSearchMatch {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly source: "user" | "assistant";
  readonly snippet: string;
  readonly messageCreatedAt: string | null;
  readonly quality?: number;
  readonly hits?: number;
  readonly messageId?: MessageId;
}

// When this client last sent an open per thread, by its own clock: a server
// timestamp would be off by any clock skew. The server merges opens closer
// together than THREAD_OPEN_DEDUPE_MS anyway, so skipping them saves a command
// and a broadcast while flipping between threads.
const sentThreadOpens = new Map<string, number>();
// When this client last opened each thread, sent or not, so recent threads
// follow quick switches the server merges.
const localThreadOpens = new Map<string, number>();
let localThreadOpensVersion = 0;
/**
 * Records that this client opened a thread, and says whether to send the open
 * to the server now.
 */
export function claimThreadOpen(environmentId: EnvironmentId, threadId: string, now: number) {
  const key = `${environmentId}:${threadId}`;
  localThreadOpens.set(key, now);
  localThreadOpensVersion += 1;
  if (now - (sentThreadOpens.get(key) ?? Number.NEGATIVE_INFINITY) < THREAD_OPEN_DEDUPE_MS) {
    return false;
  }
  sentThreadOpens.set(key, now);
  return true;
}

export interface EnvironmentThreadSearchMatch extends OrchestrationThreadSearchMatch {
  readonly environmentId: EnvironmentId;
}

export interface ThreadSearchResultsState {
  readonly matches: ReadonlyArray<EnvironmentThreadSearchMatch>;
  readonly isLoading: boolean;
}

export function threadSearchMatchKey(
  match: Pick<EnvironmentThreadSearchMatch, "environmentId" | "threadId">,
): string {
  return JSON.stringify([match.environmentId, match.threadId]);
}

export type ThreadSearchShell = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "id"
  | "title"
  | "branch"
  | "createdAt"
  | "updatedAt"
  | "latestUserMessageAt"
  | "latestUserAuthoredMessageAt"
> &
  Partial<Pick<EnvironmentThreadShell, "linkedPullRequest" | "branchPullRequest" | "opens">>;

/**
 * What the web and mobile palettes rank a thread shell by. Pass the
 * environment label only when there are two or more environments.
 */
export function threadSearchSubject(
  thread: ThreadSearchShell,
  projectTitle: string | null | undefined,
  environmentLabel?: string | null,
): ThreadSearchSubject {
  // A keystroke ranks the same shells again, so a subject is built once per shell.
  const cached = subjectCache.get(thread);
  if (
    cached !== undefined &&
    cached.projectTitle === projectTitle &&
    cached.environmentLabel === environmentLabel &&
    cached.opensVersion === localThreadOpensVersion
  ) {
    return cached.subject;
  }
  const subject = buildThreadSearchSubject(thread, projectTitle, environmentLabel);
  subjectCache.set(thread, {
    projectTitle,
    environmentLabel,
    opensVersion: localThreadOpensVersion,
    subject,
  });
  return subject;
}

const subjectCache = new WeakMap<
  ThreadSearchShell,
  {
    readonly projectTitle: string | null | undefined;
    readonly environmentLabel: string | null | undefined;
    readonly opensVersion: number;
    readonly subject: ThreadSearchSubject;
  }
>();

function buildThreadSearchSubject(
  thread: ThreadSearchShell,
  projectTitle: string | null | undefined,
  environmentLabel: string | null | undefined,
): ThreadSearchSubject {
  // What the user wrote, not agent wakes or task notices in the user role. A
  // thread the user never wrote in counts from its creation; an older server
  // omits the field, so the latest user-role message stands in.
  const authored = thread.latestUserAuthoredMessageAt;
  const activityAt =
    authored === undefined
      ? getThreadSortTimestamp(thread, "updated_at")
      : Date.parse(authored ?? thread.createdAt);
  const localOpenedAt = localThreadOpens.get(`${thread.environmentId}:${thread.id}`) ?? 0;
  return {
    id: thread.id,
    title: thread.title,
    branch: thread.branch,
    projectTitle: projectTitle ?? null,
    environmentLabel: environmentLabel ?? null,
    pullRequests: threadSearchPullRequests(thread),
    activityAt: Number.isFinite(activityAt) ? activityAt : null,
    // This client's own latest open counts too: the server merged it, or has
    // no record yet (an older server ignores opens).
    opens:
      localOpenedAt > (thread.opens?.openedAt ?? 0)
        ? { score: 1, picks: [], ...thread.opens, openedAt: localOpenedAt }
        : (thread.opens ?? null),
  };
}

/** Message result keys in the order a search box last showed them for `query`. */
export interface ShownOrder {
  readonly query: string;
  readonly keys: ReadonlyArray<string>;
  /** How many of `keys` are on screen; only those hold their places. */
  readonly shown: number;
}

// Rows past the limit a slower environment's best matches may take.
const LATE_ROOM = 3;

/**
 * Keep shown rows in place so late results cannot move the pointer or keyboard target.
 * Allow up to LATE_ROOM extra rows so late best matches remain visible.
 * Reuse `previous` when unchanged to avoid a React state update.
 */
export function nextShownOrder(
  previous: ShownOrder | null,
  query: string,
  ranked: ReadonlyArray<string>,
  limit: number,
): ShownOrder {
  if (previous?.query !== query) {
    return { query, keys: ranked, shown: Math.min(limit, ranked.length) };
  }
  const listed = new Set(ranked);
  const kept = previous.keys.slice(0, previous.shown).filter((key) => listed.has(key));
  const held = new Set(kept);
  const seen = new Set(previous.keys);
  const rest = ranked.filter((key) => !held.has(key));
  const arrived = rest.filter((key) => !seen.has(key)).length;
  const keys = [...kept, ...rest];
  const shown = Math.min(
    keys.length,
    limit + LATE_ROOM,
    Math.max(limit, kept.length + Math.min(arrived, LATE_ROOM)),
  );
  const unchanged =
    shown === previous.shown &&
    keys.length === previous.keys.length &&
    keys.every((key, index) => key === previous.keys[index]);
  return unchanged ? previous : { query, keys, shown };
}

export interface SettledThreadSearch {
  readonly query: string;
  readonly matches: ReadonlyArray<EnvironmentThreadSearchMatch>;
}

/**
 * What a search box shows for `query`: its own results once they arrive
 * (`ready`), else the previous results if `query` refines or widens their
 * query, so result rows do not blink out and back on every keystroke.
 * Results for an unrelated query clear.
 */
export function visibleThreadSearch(
  query: string,
  ready: SettledThreadSearch | null,
  previous: SettledThreadSearch | null,
): SettledThreadSearch {
  if (ready !== null) return ready;
  const current = foldSearchQuery(query);
  const before = foldSearchQuery(previous?.query ?? "");
  return previous !== null &&
    current.length > 0 &&
    before.length > 0 &&
    (current.startsWith(before) || before.startsWith(current))
    ? previous
    : { query: "", matches: [] };
}
