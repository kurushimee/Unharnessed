// T3 Code's server keybindings (apps/server/src/keybindings.ts), for kuru code: the
// user's rules live in keybindings.json in kuru code's data folder, which the main
// process reads and writes; they are merged over the defaults as T3 Code's server
// merges them, and saved the way its upsert and remove save them.
import {
  KeybindingRule,
  MAX_KEYBINDINGS_COUNT,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingsConfig,
  type ServerRemoveKeybindingInput,
  type ServerUpsertKeybindingInput,
} from "~/contracts";
import {
  compileResolvedKeybindingRule,
  compileResolvedKeybindingsConfig,
  DEFAULT_KEYBINDINGS,
  mergeWithDefaultKeybindings,
  parseKeybindingShortcut,
  parseKeybindingWhenExpression,
} from "~/shared/keybindings";
import * as Schema from "effect/Schema";
import { invoke } from "~/bridge";

type Entry = { readonly value: unknown; readonly rule: KeybindingRule | null };

const decodeRule = Schema.decodeUnknownOption(KeybindingRule);

function encodeShortcut(shortcut: KeybindingShortcut): string | null {
  const modifiers: string[] = [];
  if (shortcut.modKey) modifiers.push("mod");
  if (shortcut.metaKey) modifiers.push("meta");
  if (shortcut.ctrlKey) modifiers.push("ctrl");
  if (shortcut.altKey) modifiers.push("alt");
  if (shortcut.shiftKey) modifiers.push("shift");
  if (!shortcut.key) return null;
  if (shortcut.key !== "+" && shortcut.key.includes("+")) return null;
  const key = shortcut.key === " " ? "space" : shortcut.key;
  return [...modifiers, key].join("+");
}

function encodeWhenAst(node: KeybindingWhenNode): string {
  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      return `!(${encodeWhenAst(node.node)})`;
    case "and":
      return `(${encodeWhenAst(node.left)} && ${encodeWhenAst(node.right)})`;
    case "or":
      return `(${encodeWhenAst(node.left)} || ${encodeWhenAst(node.right)})`;
  }
}

// Settings sends replace/remove targets in its own normalized spelling, which can differ from a
// hand-edited file ("cmd+k" vs "meta+k", "a&&b" vs "a && b"), so compare parsed forms.
function ruleIdentity(rule: KeybindingRule): string {
  const shortcut = parseKeybindingShortcut(rule.key);
  const key = (shortcut && encodeShortcut(shortcut)) ?? rule.key;
  if (rule.when === undefined) return JSON.stringify([rule.command, key, null]);
  const whenAst = parseKeybindingWhenExpression(rule.when);
  return JSON.stringify([rule.command, key, whenAst ? encodeWhenAst(whenAst) : rule.when]);
}

function sameRule(left: KeybindingRule, right: KeybindingRule): boolean {
  return ruleIdentity(left) === ruleIdentity(right);
}

function shortcutContext(rule: KeybindingRule): string | null {
  const parsed = parseKeybindingShortcut(rule.key);
  const encoded = parsed ? encodeShortcut(parsed) : null;
  return encoded ? `${encoded}\u0000${rule.when ?? ""}` : null;
}

function ruleOf(input: ServerRemoveKeybindingInput): KeybindingRule {
  return input.when === undefined
    ? { key: input.key, command: input.command }
    : { key: input.key, command: input.command, when: input.when };
}

// Entries this build cannot decode, such as a typo or a command from a newer
// build, are written back unchanged so editing another shortcut keeps them.
function entriesOf(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => {
    const decoded = decodeRule(value);
    return decoded._tag === "Some" && compileResolvedKeybindingRule(decoded.value)
      ? { value: decoded.value, rule: decoded.value }
      : { value, rule: null };
  });
}

/** T3 Code's startup sync: defaults for commands the file lacks go first, unless their keys are taken. */
function withMissingDefaults(entries: Entry[]): Entry[] {
  const rules = entries.flatMap(({ rule }) => (rule ? [rule] : []));
  const commands = new Set(rules.map((rule) => rule.command));
  const missing = DEFAULT_KEYBINDINGS.filter(
    (rule) =>
      !commands.has(rule.command) &&
      !rules.some((entry) => {
        const context = shortcutContext(entry);
        return context !== null && context === shortcutContext(rule);
      }),
  );
  const slots = Math.max(0, MAX_KEYBINDINGS_COUNT - entries.length);
  return [...missing.slice(0, slots).map((rule) => ({ value: rule, rule })), ...entries];
}

let entries: Entry[] | null = null;
const listeners = new Set<(config: ResolvedKeybindingsConfig) => void>();

function resolved(): ResolvedKeybindingsConfig {
  const rules = (entries ?? []).flatMap(({ rule }) => (rule ? [rule] : []));
  return mergeWithDefaultKeybindings(compileResolvedKeybindingsConfig(rules));
}

function publish(): void {
  const config = resolved();
  for (const listener of listeners) listener(config);
}

async function save(next: Entry[]): Promise<ResolvedKeybindingsConfig> {
  const capped = next.length > MAX_KEYBINDINGS_COUNT ? next.slice(-MAX_KEYBINDINGS_COUNT) : next;
  await invoke("keybindings.set", { rules: capped.map(({ value }) => value) });
  entries = capped;
  publish();
  return resolved();
}

/** Reads the file once; a missing file is T3 Code's first start, which writes the defaults. */
export async function loadKeybindings(): Promise<void> {
  const raw = await invoke<unknown>("keybindings.get").catch(() => null);
  if (raw === null) {
    await save(DEFAULT_KEYBINDINGS.map((rule) => ({ value: rule, rule })));
    return;
  }
  const read = entriesOf(raw);
  const synced = withMissingDefaults(read);
  if (synced.length !== read.length) await save(synced);
  else {
    entries = read;
    publish();
  }
}

export function onKeybindingsChange(listener: (config: ResolvedKeybindingsConfig) => void): void {
  listeners.add(listener);
}

export function readKeybindings(): ResolvedKeybindingsConfig {
  return resolved();
}

export async function upsertKeybinding(
  input: ServerUpsertKeybindingInput,
): Promise<ResolvedKeybindingsConfig> {
  if (entries === null) await loadKeybindings();
  const rule = ruleOf(input);
  const replace = input.replace ? ruleOf(input.replace) : null;
  return save([
    ...(entries ?? []).filter(
      ({ rule: entry }) =>
        !entry || (!sameRule(entry, rule) && (replace === null || !sameRule(entry, replace))),
    ),
    { value: rule, rule },
  ]);
}

export async function removeKeybinding(
  input: ServerRemoveKeybindingInput,
): Promise<ResolvedKeybindingsConfig> {
  if (entries === null) await loadKeybindings();
  const target = ruleOf(input);
  return save((entries ?? []).filter(({ rule }) => !rule || !sameRule(rule, target)));
}
