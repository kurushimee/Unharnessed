// Adapted from T3 Code's components/settings/settingsSearch.ts: kuru code's settings
// pages, their order in the settings sidebar, and the rows settings search finds.
import { isMacPlatform, normalizeSearchText } from "~/lib/utils";
import { STATIC_KEYBINDING_COMMANDS, type KeybindingCommand } from "~/contracts";
import { DEFAULT_KEYBINDINGS } from "~/shared/keybindings";
import * as Schema from "effect/Schema";
import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "../../appearanceFonts";
import { writeLocalStorageValue } from "../../hooks/useLocalStorage";
import { commandLabel } from "./KeybindingsSettings.logic";

export type SettingsPath =
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/chat"
  | "/settings/diffs"
  | "/settings/keybindings"
  | "/settings/providers"
  | "/settings/agent"
  | "/settings/mcp"
  | "/settings/skills"
  | "/settings/instructions"
  | "/settings/projects"
  | "/settings/about"
  | "/settings/archived";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
  readonly searchTerms?: ReadonlyArray<string>;
  readonly macOnly?: boolean;
  readonly secondary?: boolean;
}

export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsPath, string>> = {
  "/settings/general": "General",
  "/settings/appearance": "Appearance",
  "/settings/chat": "Chat",
  "/settings/diffs": "Diffs & pull requests",
  "/settings/keybindings": "Keybindings",
  "/settings/providers": "Providers",
  "/settings/agent": "Agent",
  "/settings/mcp": "MCP servers",
  "/settings/skills": "Skills",
  "/settings/instructions": "Instructions",
  "/settings/projects": "Projects",
  "/settings/about": "About",
  "/settings/archived": "Archive",
};

/** Sidebar order. A group without a heading is set apart by space alone. */
export const SETTINGS_NAV_GROUPS: ReadonlyArray<{
  readonly heading: string | null;
  readonly paths: ReadonlyArray<SettingsPath>;
}> = [
  {
    heading: null,
    paths: [
      "/settings/general",
      "/settings/appearance",
      "/settings/chat",
      "/settings/diffs",
      "/settings/keybindings",
    ],
  },
  {
    heading: "Agent",
    paths: [
      "/settings/providers",
      "/settings/agent",
      "/settings/mcp",
      "/settings/skills",
      "/settings/instructions",
    ],
  },
  {
    heading: "Code",
    paths: ["/settings/projects"],
  },
  {
    heading: null,
    paths: ["/settings/about", "/settings/archived"],
  },
];

export function keybindingSearchAnchorId<Command extends KeybindingCommand>(command: Command) {
  return `keybinding-${command}` as const;
}

const KEYBINDING_SEARCH_ITEMS = STATIC_KEYBINDING_COMMANDS.toSorted((left, right) =>
  commandLabel(left).localeCompare(commandLabel(right)),
).map((command) => {
  const defaultKeys = DEFAULT_KEYBINDINGS.filter((binding) => binding.command === command).map(
    (binding) => binding.key,
  );
  return {
    id: keybindingSearchAnchorId(command),
    title: commandLabel(command),
    to: "/settings/keybindings" as const,
    searchTerms: [command, ...defaultKeys],
    secondary: true,
    ...(defaultKeys.length === 0 ? { targetId: "keybindings" } : {}),
  };
});

export const SETTINGS_SEARCH_ITEMS = [
  {
    id: "app-version",
    title: "Version",
    to: "/settings/about",
    searchTerms: ["about check for updates download install upgrade release"],
  },
  {
    id: "archive-confirmation",
    title: "Archive confirmation",
    to: "/settings/general",
    searchTerms: ["ask before thread second click inline action"],
  },
  {
    id: "chat-width",
    title: "Chat width",
    to: "/settings/appearance",
    searchTerms: ["wide full width column layout messages composer monitor"],
  },
  {
    id: "code-font",
    title: "Code font",
    to: "/settings/appearance",
    searchTerms: ["typography family size monospace code blocks diffs file previews"],
  },
  {
    id: "color-scheme",
    title: "Color scheme",
    to: "/settings/appearance",
    searchTerms: ["appearance light dark system mode"],
    targetId: "appearance",
  },
  {
    id: "composer-context",
    title: "Composer context",
    to: "/settings/appearance",
  },
  {
    id: "composer-rich-text",
    title: "Rich text composer",
    to: "/settings/chat",
    searchTerms: ["composer rich text tiptap bold italic markdown styled wysiwyg"],
  },
  {
    id: "default-diff-file-state",
    title: "Default diff file state",
    to: "/settings/diffs",
    searchTerms: ["collapsed expanded collapse expand files pull request pr code tab"],
  },
  {
    id: "delete-confirmation",
    title: "Delete confirmation",
    to: "/settings/general",
    searchTerms: ["ask before thread chat history"],
  },
  {
    id: "diff-color-scheme",
    title: "Diff colors",
    to: "/settings/diffs",
    searchTerms: ["red green blue orange additions deletions changes counts palette colorblind"],
  },
  {
    id: "diff-layout",
    title: "Diff layout",
    to: "/settings/diffs",
    searchTerms: ["stacked split side by side unified inline view"],
  },
  {
    id: "effort-display",
    title: "Effort display",
    to: "/settings/appearance",
    searchTerms: ["reasoning effort thinking bars graph word label level composer"],
  },
  {
    id: "follow-up-behavior",
    title: "Follow-up behavior",
    to: "/settings/chat",
    searchTerms: ["queue steer running turn send default behavior composer"],
  },
  {
    id: "font-smoothing",
    title: "Font smoothing",
    to: "/settings/appearance",
    searchTerms: ["typography text grayscale anti aliasing macos thin"],
    macOnly: true,
  },
  {
    id: "hide-whitespace-changes",
    title: "Hide whitespace changes",
    to: "/settings/diffs",
    searchTerms: ["diff ignore spaces edits default"],
  },
  {
    id: "interface-font",
    title: "Interface font",
    to: "/settings/appearance",
    searchTerms: ["typography family size system sans"],
  },
  {
    id: "keybindings",
    title: "Keybindings",
    to: "/settings/keybindings",
    searchTerms: ["keyboard shortcuts hotkeys commands bindings json"],
  },
  {
    id: "math-rendering",
    title: "Render math",
    to: "/settings/appearance",
    searchTerms: ["latex tex katex equations formulas markdown"],
  },
  {
    id: "open-source-licenses",
    title: "Open source licenses",
    to: "/settings/about",
  },
  {
    id: "panel-animations",
    title: "Panel animations",
    to: "/settings/appearance",
  },
  {
    id: "project-order",
    title: "Project order",
    to: "/settings/general",
    searchTerms: ["sort projects sidebar manual created recent"],
  },
  {
    id: "prompt-font",
    title: "Prompt font",
    to: "/settings/appearance",
    searchTerms: ["typography family size composer input"],
  },
  {
    id: "screen-reader-announcements",
    title: "Screen reader announcements",
    to: "/settings/chat",
    searchTerms: [
      "accessibility a11y screen reader nvda jaws voiceover orca narrator speech announce read aloud messages activity steps",
    ],
  },
  {
    id: "send-shortcut",
    title: "Send shortcut",
    to: "/settings/chat",
    searchTerms: ["enter return command ctrl multiline prompt new line composer"],
  },
  {
    id: "separate-fonts",
    title: "Separate fonts",
    to: "/settings/appearance",
    searchTerms: ["typography advanced prompt code terminal font family size individually"],
  },
  {
    // Prefixed because the slider control already owns the `appearance-contrast` id.
    id: "setting-appearance-contrast",
    title: "Contrast",
    to: "/settings/appearance",
    searchTerms: ["colors borders interface"],
  },
  {
    // Prefixed because the slider control already owns the `glass-opacity` id.
    id: "setting-glass-opacity",
    title: "Glass opacity",
    to: "/settings/appearance",
    searchTerms: ["transparent transparency solid menus dialogs composer"],
  },
  {
    id: "skills-in-slash-menu",
    title: "Show skills in slash menu",
    to: "/settings/chat",
    searchTerms: ["command menu dollar $ slash /"],
  },
  {
    id: "theme",
    title: "Themes",
    to: "/settings/appearance",
    searchTerms: ["appearance colors palette custom import"],
    targetId: "appearance",
  },
  {
    id: "thread-details-items",
    title: "Thread details",
    to: "/settings/appearance",
    searchTerms: [
      "customize show hide panel card environment editor scripts branch pull request git changes servers automations lineage usage limits 5 hour weekly quota tokens context window",
    ],
  },
  {
    id: "thread-notifications",
    title: "Thread notifications",
    to: "/settings/general",
    searchTerms: ["notification sound alert completion input approval desktop"],
  },
  {
    id: "time-format",
    title: "Time format",
    to: "/settings/general",
    searchTerms: ["timestamp clock locale system browser os 12 hour 24 hour"],
  },
  {
    id: "tool-call-visibility",
    title: "Tool calls in chat",
    to: "/settings/chat",
    searchTerms: [
      "hide tool calls commands edits searches work log activity quiet chat zen final answers only",
    ],
  },
  {
    id: "unpin-confirmation",
    title: "Unpin confirmation",
    to: "/settings/general",
    searchTerms: ["ask before thread pinned section"],
  },
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/appearance",
    searchTerms: ["long lines code blocks diffs file previews"],
  },
  {
    id: "working-shelf",
    title: "Working section",
    to: "/settings/general",
    searchTerms: ["hide fold running monitoring threads inbox sidebar shelf"],
  },
  {
    id: "pull-request-links-open-in-app",
    title: "Open pull requests in kuru code",
    to: "/settings/diffs",
    searchTerms: ["pr links github browser external click default pull request view page"],
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/providers",
    searchTerms: ["sign in subscription api key connect disconnect openai anthropic claude chatgpt"],
  },
  {
    id: "local-models",
    title: "Local models",
    to: "/settings/providers",
    searchTerms: ["ollama lm studio llama.cpp vllm server this machine add"],
  },
  {
    id: "compaction",
    title: "Compact automatically",
    to: "/settings/agent",
    searchTerms: ["compaction summarize context full window"],
  },
  {
    id: "summary-model",
    title: "Summary model",
    to: "/settings/agent",
    searchTerms: ["compaction auxiliary model summaries"],
  },
  {
    id: "retries",
    title: "Retry failed requests",
    to: "/settings/agent",
    searchTerms: ["retry retries wait delay backoff errors"],
  },
  {
    id: "provider-switching",
    title: "Switch providers",
    to: "/settings/agent",
    searchTerms: ["failover fallback another provider same model retries"],
  },
  {
    id: "usage-limit-wait",
    title: "Wait for the reset",
    to: "/settings/agent",
    searchTerms: ["usage limits plan pause resume reset hours"],
  },
  {
    id: "image-model",
    title: "Image model",
    to: "/settings/agent",
    searchTerms: ["images vision read pictures screenshots"],
  },
  {
    id: "shrink-images",
    title: "Shrink large images",
    to: "/settings/agent",
    searchTerms: ["images resize scale down"],
  },
  {
    id: "block-images",
    title: "Block images",
    to: "/settings/agent",
    searchTerms: ["images never send privacy"],
  },
  {
    id: "mcp-servers",
    title: "MCP servers",
    to: "/settings/mcp",
    searchTerms: ["model context protocol tools servers sign in token add remove"],
  },
  {
    id: "skills",
    title: "Skills",
    to: "/settings/skills",
    searchTerms: ["skill.md new create enable disable"],
  },
  {
    id: "skill-folders",
    title: "Skill folders",
    to: "/settings/skills",
    searchTerms: ["skills directories paths add remove"],
  },
  {
    id: "model-instructions",
    title: "Model instructions",
    to: "/settings/instructions",
    searchTerms: ["system prompt instructions per model agents.md"],
  },
  {
    id: "project-overview",
    title: "Project overview",
    to: "/settings/projects",
    searchTerms: ["name icon emoji image remove"],
  },
  {
    id: "archive",
    title: "Archived threads",
    to: "/settings/archived",
    searchTerms: ["restore reopen unarchive history projects"],
  },
  ...KEYBINDING_SEARCH_ITEMS,
] as const satisfies ReadonlyArray<SettingsSearchItem>;

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEMS)[number]["id"];

const SEARCH_ITEMS_BY_ID = new Map(SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item] as const));

export function searchableSetting(id: SettingsSearchItemId): {
  readonly id: string;
  readonly title: string;
} {
  const { id: anchorId, title } = SEARCH_ITEMS_BY_ID.get(id)!;
  return { id: anchorId, title };
}

/** The settings that exist on this platform. */
export function settingsForThisPlatform(
  items: ReadonlyArray<SettingsSearchItem>,
): ReadonlyArray<SettingsSearchItem> {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  return items.filter((item) => !item.macOnly || isMacPlatform(platform));
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];
  const queryTokens = normalizedQuery.split(" ");

  return settingsForThisPlatform(items)
    .flatMap((item, index) => {
      const title = normalizeSearchText(item.title);
      const fields = [
        title,
        normalizeSearchText(SETTINGS_SECTION_LABELS[item.to]),
        ...(item.searchTerms ?? []).map(normalizeSearchText),
      ];
      if (!queryTokens.every((token) => fields.some((field) => field.includes(token)))) return [];

      const exactPhraseField = fields.findIndex((field) => field.includes(normalizedQuery));
      const rank =
        title === normalizedQuery
          ? 5
          : title.startsWith(normalizedQuery)
            ? 4
            : title.includes(normalizedQuery)
              ? 3
              : queryTokens.every((token) => title.includes(token))
                ? 2
                : exactPhraseField >= 0
                  ? 1
                  : 0;
      return [{ item, index, rank }];
    })
    .toSorted(
      (left, right) =>
        Number(left.item.secondary ?? false) - Number(right.item.secondary ?? false) ||
        right.rank - left.rank ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}

// These rows only exist with separate fonts on, so a search jump to one turns them on.
const ADVANCED_TYPOGRAPHY_TARGET_IDS: ReadonlySet<string> = new Set(["prompt-font"]);

export function isAdvancedTypographyTarget(targetId: string): boolean {
  return ADVANCED_TYPOGRAPHY_TARGET_IDS.has(targetId);
}

/**
 * Opens the persisted section a search result lives in before jumping to it, so
 * its row is mounted to scroll to.
 */
export function revealSettingsSearchTarget(targetId: string): void {
  if (isAdvancedTypographyTarget(targetId)) {
    writeLocalStorageValue(TYPOGRAPHY_ADVANCED_STORAGE_KEY, true, false, Schema.Boolean);
  }
}
