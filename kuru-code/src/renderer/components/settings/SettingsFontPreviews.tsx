import type { ServerProviderSkill } from "~/contracts";
import { preloadPatchFile } from "@pierre/diffs/ssr";
import { useAtomValue } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { useRef, useState } from "react";
import {
  ComposerPromptEditorTiptap as ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "../ComposerPromptEditorTiptap";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "../composerContextPresentation";
import { useRenderedAppearance } from "../../hooks/useTheme";
import { DEFAULT_COMPOSER_PLACEHOLDER } from "../../composerPlaceholder";
import { resolveDiffThemeName, type DiffThemeName } from "../../lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "../../lib/syntaxHighlighting";

const PREVIEW_SKILLS: ReadonlyArray<ServerProviderSkill> = [
  { name: "frontend-design", path: ".agents/skills/frontend-design/SKILL.md", enabled: true },
];

const PROMPT_PREVIEW_TEXT =
  "Use $frontend-design to fix the flaky test in " +
  "[threads.ts](src/main/threads.ts) and align the header with " +
  "[SettingsPanels.tsx](src/renderer/components/settings/SettingsPanels.tsx) before shipping.";

function noop() {}

export function PromptFontPreview() {
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const [prompt, setPrompt] = useState(PROMPT_PREVIEW_TEXT);
  const [cursor, setCursor] = useState(PROMPT_PREVIEW_TEXT.length);
  const onChange = (nextValue: string, nextCursor: number) => {
    setPrompt(nextValue);
    setCursor(nextCursor);
  };
  return (
    <div className="mt-1 mb-2 rounded-lg border border-border bg-background px-3 py-2">
      <ComposerPromptEditor
        ariaLabel="Prompt font preview"
        editorRef={editorRef}
        value={prompt}
        cursor={cursor}
        contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
        skills={PREVIEW_SKILLS}
        disabled={false}
        placeholder={DEFAULT_COMPOSER_PLACEHOLDER}
        className="max-h-42"
        onChange={onChange}
        onPaste={noop}
      />
    </div>
  );
}

const DIFF_PREVIEW_PATCH = [
  "diff --git a/src/formatUser.ts b/src/formatUser.ts",
  "--- a/src/formatUser.ts",
  "+++ b/src/formatUser.ts",
  "@@ -1,3 +1,3 @@",
  " export function formatUser(user: User) {",
  "-  return user.name.toUpperCase();",
  "+  return `${user.name} <${user.email}>`; // 0O 1lI",
  " }",
  "",
].join("\n");

// FileDiff remounts can retain unhighlighted frames after a race; use static highlighted HTML in shadow DOM.
function loadDiffPreviewHtml(theme: DiffThemeName): Promise<readonly string[]> {
  return preloadPatchFile({
    patch: DIFF_PREVIEW_PATCH,
    options: { diffStyle: "unified", theme, preferredHighlighter: PREFERRED_HIGHLIGHTER },
  }).then((results) => results.map((result) => result.prerenderedHTML));
}

// Unlayered shadow-root rules override Pierre surfaces with app code tokens to match the diff panel.
const DIFF_PREVIEW_THEME_BRIDGE = `
  :host {
    color: var(--code-foreground);
    background-color: var(--code-background);
    --diffs-fg: var(--code-foreground);
    --diffs-bg: var(--code-background);
    --diffs-light-bg: var(--code-background);
    --diffs-dark-bg: var(--code-background);
  }
  [data-diffs-header] {
    background-color: var(--code-background);
    color: var(--code-foreground);
  }
`;

// Each host is keyed by its html, so the ref callback runs once per document.
// React detaches a cleanup-less ref callback with null when an appearance switch drops the host.
function StaticDiffHtml({ html }: { html: string }) {
  const attachHtml = (host: HTMLDivElement | null) => {
    if (host === null) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadow.innerHTML = html;
    const bridge = document.createElement("style");
    bridge.textContent = DIFF_PREVIEW_THEME_BRIDGE;
    shadow.append(bridge);
  };
  return <div ref={attachHtml} />;
}

const diffPreviewHtmlAtom = Atom.family((theme: DiffThemeName) =>
  Atom.make(Effect.promise(() => loadDiffPreviewHtml(theme))).pipe(
    Atom.keepAlive,
    Atom.withLabel(`settings-diff-preview:${theme}`),
  ),
);

export function CodeFontPreview() {
  const resolvedTheme = useRenderedAppearance();
  const loadedHtml = AsyncResult.getOrElse(
    useAtomValue(diffPreviewHtmlAtom(resolveDiffThemeName(resolvedTheme))),
    () => null,
  );
  // An appearance switch keeps the previous theme's preview up while the new one renders.
  const [htmlByFile, setHtmlByFile] = useState(loadedHtml);
  if (loadedHtml !== null && loadedHtml !== htmlByFile) setHtmlByFile(loadedHtml);
  if (htmlByFile === null) return null;
  return (
    <div className="mt-1 mb-2 space-y-2">
      {htmlByFile.map((html) => (
        <StaticDiffHtml key={html} html={html} />
      ))}
    </div>
  );
}
