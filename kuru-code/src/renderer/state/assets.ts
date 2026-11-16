// Adapted from T3 Code's state/assets.ts: a project's favicon URL, asked of
// kuru code's main process once per folder and shared by every row showing it.
import { useSyncExternalStore } from "react";
import { invoke } from "~/bridge";

const urls = new Map<string, string | null>();
const asked = new Set<string>();
const listeners = new Set<() => void>();

function ask(cwd: string): void {
  if (asked.has(cwd)) return;
  asked.add(cwd);
  void invoke<string | null>("project.favicon", { cwd })
    .catch(() => null)
    .then((url) => {
      urls.set(cwd, url);
      for (const listener of listeners) listener();
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The project's icon, `null` until known or when it has none. */
export function useProjectFaviconUrl(cwd: string): string | null {
  ask(cwd);
  return useSyncExternalStore(subscribe, () => urls.get(cwd) ?? null);
}

/** Forgets the folders' icons, so the next render asks again. */
export function invalidateProjectFavicons(): void {
  asked.clear();
}
