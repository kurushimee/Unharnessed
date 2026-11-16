// The extension's settings actions (vscode/webview/Settings.tsx), for kuru code's settings
// pages: a change shows at once and is sent to the agent through the main process; the
// agent's answer (`settingResult`) replaces it, or its refusal shows under the control.
import { useEffect, useRef, useState } from "react";
import type { WebviewMessage } from "@shared/protocol";
import { post } from "~/bridge";
import { useStore } from "~/state";

export type Write = (key: string, value: unknown) => void;

export type SettingsActions = {
  /** Shown before the agent answers, by key. */
  readonly drafts: Readonly<Record<string, unknown>>;
  /** The agent's refusals, by key. */
  readonly errors: Readonly<Record<string, string>>;
  /** Sends `message` under `key`, showing `draft` until the agent answers. */
  readonly act: (key: string, draft: unknown, message: WebviewMessage) => void;
  /** The agent runs: changes can be sent. */
  readonly ready: boolean;
  /** A setting of `~/.unharnessed/settings.json`: the draft, else the file's, else the default. */
  readonly value: (key: string) => unknown;
  /** Writes a setting; a value equal to the default is removed from the file. */
  readonly write: Write;
};

export function useSettingsActions(): SettingsActions {
  const result = useStore((state) => state.settingResult);
  const view = useStore((state) => state.settings.view);
  const ready = useStore((state) => state.agent?.kind === "ready");
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!result) return;
    setDrafts(({ [result.key]: _, ...rest }) => rest);
    setErrors(({ [result.key]: _, ...rest }) =>
      result.error ? { ...rest, [result.key]: result.error } : rest,
    );
  }, [result]);

  const act: SettingsActions["act"] = (key, draft, message) => {
    setDrafts((current) => ({ ...current, [key]: draft }));
    setErrors(({ [key]: _, ...rest }) => rest);
    post(message);
  };
  const value = (key: string): unknown => {
    if (key in drafts) return drafts[key];
    return view?.values[key] ?? view?.defaults[key] ?? null;
  };
  const write: Write = (key, next) => {
    const stored =
      next !== null && JSON.stringify(next) === JSON.stringify(view?.defaults[key]) ? null : next;
    act(key, next ?? view?.defaults[key] ?? null, { type: "setSetting", key, value: stored });
  };
  return { drafts, errors, act, ready, value, write };
}

/**
 * Calls `done` once the action sent under `key` after the returned function ran settles
 * without an error: a dialog closes once the agent took the change.
 */
export function useSettled(
  key: string,
  { drafts, errors }: Pick<SettingsActions, "drafts" | "errors">,
  done: () => void,
): () => void {
  const sent = useRef(false);
  const busy = key in drafts;
  useEffect(() => {
    if (!sent.current || busy) return;
    sent.current = false;
    if (!(key in errors)) done();
  }, [busy]);
  return () => {
    sent.current = true;
  };
}
