// Adapted from T3 Code's state/vcs.ts: a folder's checked-out branch, shared
// by every sidebar row showing a thread of it. Read when first shown, again
// once it is 15 seconds old and when the window regains focus.
import { useSyncExternalStore } from "react";
import { invoke } from "~/bridge";

const STALE_MS = 15_000;
const branches = new Map<string, { refName: string | null; at: number }>();
const pending = new Set<string>();
const listeners = new Set<() => void>();

function read(cwd: string): void {
  if (pending.has(cwd)) return;
  const known = branches.get(cwd);
  if (known && Date.now() - known.at < STALE_MS) return;
  pending.add(cwd);
  void invoke<string | null>("git.branch", { cwd })
    .catch(() => null)
    .then((refName) => {
      pending.delete(cwd);
      const before = branches.get(cwd);
      branches.set(cwd, { refName, at: Date.now() });
      if (before?.refName !== refName) for (const listener of listeners) listener();
    });
}

if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    for (const cwd of branches.keys()) branches.set(cwd, { ...branches.get(cwd)!, at: 0 });
    for (const listener of listeners) listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The folder's branch (`data.refName`), or no data until read; `null` cwd reads nothing. */
export function useVcsBranch(cwd: string | null): { data: { refName: string | null } | undefined } {
  if (cwd !== null) read(cwd);
  const known = useSyncExternalStore(subscribe, () => (cwd === null ? undefined : branches.get(cwd)));
  return { data: known };
}
