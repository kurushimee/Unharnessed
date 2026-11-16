import { useCallback, useEffect, useRef, useState } from "react";
import type { GitStatus } from "@shared/git";
import { invoke } from "~/bridge";

/**
 * The thread folder's git state: read on open, every 15 s while the window
 * has focus, on focus, and when a turn ends (the agent may have changed files).
 */
export function useGitStatus(cwd: string | null, busy: boolean) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const asked = useRef(0);
  const refresh = useCallback(async () => {
    if (!cwd) return;
    const ticket = ++asked.current;
    try {
      const next = await invoke<GitStatus>("git.status", { cwd });
      if (ticket === asked.current) setStatus(next);
    } catch {
      if (ticket === asked.current) setStatus({ repo: false });
    }
  }, [cwd]);

  useEffect(() => {
    setStatus(null);
    void refresh();
    const timer = setInterval(() => document.hasFocus() && void refresh(), 15_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) void refresh();
    wasBusy.current = busy;
  }, [busy, refresh]);

  return { status, refresh };
}

export type GitState = ReturnType<typeof useGitStatus>;
