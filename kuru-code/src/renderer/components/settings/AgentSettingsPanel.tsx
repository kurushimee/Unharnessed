// The agent's settings (`~/.unharnessed/settings.json`): the extension's General tab
// (vscode/webview/Settings.tsx), shown as T3 Code shows its settings.
import { useEffect, useState } from "react";
import { useStore } from "~/state";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Switch } from "../ui/switch";
import { AgentRestartNotice, ModelSelect, useModelChoices } from "./agentSettingsCommon";
import { useSettingsActions, type SettingsActions } from "./settingsActions";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting, type SettingsSearchItemId } from "./settingsSearch";

/** How a number is shown and typed; the file holds counts or ms. */
type Unit = "count" | "seconds" | "hours";

type Field = { key: string; label: string; help?: string; search?: SettingsSearchItemId } & (
  | { kind: "switch" }
  | { kind: "number"; unit: Unit; max: number }
  | { kind: "model"; none: string; images?: boolean }
);

type Group = {
  id: string;
  label: string;
  help?: string;
  fields: Field[];
  /** The switch whose off state makes the other fields moot. */
  gate?: string;
};

const GROUPS: Group[] = [
  {
    id: "compaction",
    label: "Compaction",
    help: "Summarizes older messages when the context fills up.",
    gate: "compaction.enabled",
    fields: [
      {
        kind: "switch",
        key: "compaction.enabled",
        label: "Compact automatically",
        help: "Before the context is full.",
        search: "compaction",
      },
      {
        kind: "model",
        key: "auxiliaryModel",
        label: "Summary model",
        help: "Writes the summaries.",
        none: "Same as the chat model",
        search: "summary-model",
      },
    ],
  },
  {
    id: "retries",
    label: "Retries",
    help: "When a request to the provider fails, it is sent again after a wait that doubles each time.",
    gate: "retry.enabled",
    fields: [
      { kind: "switch", key: "retry.enabled", label: "Retry failed requests", search: "retries" },
      { kind: "number", key: "retry.maxRetries", label: "Retries", unit: "count", max: 100 },
      { kind: "number", key: "retry.baseDelayMs", label: "First wait", unit: "seconds", max: 3_600_000 },
      {
        kind: "number",
        key: "retry.provider.maxRetryDelayMs",
        label: "Longest wait",
        help: "When the provider asks to wait longer, the request fails.",
        unit: "seconds",
        max: 86_400_000,
      },
    ],
  },
  {
    id: "provider-switching-group",
    label: "Switching providers",
    help: "When another connected provider serves the same model, a request that keeps failing moves to it. These retries then replace the ones above.",
    gate: "retry.failover.enabled",
    fields: [
      { kind: "switch", key: "retry.failover.enabled", label: "Switch providers", search: "provider-switching" },
      { kind: "number", key: "retry.failover.maxRetries", label: "Retries per provider", unit: "count", max: 100 },
      { kind: "number", key: "retry.failover.baseDelayMs", label: "First wait", unit: "seconds", max: 3_600_000 },
      { kind: "number", key: "retry.failover.maxDelayMs", label: "Longest wait", unit: "seconds", max: 3_600_000 },
    ],
  },
  {
    id: "usage-limits",
    label: "Usage limits",
    help: "When a plan's usage limit is reached.",
    gate: "retry.provider.waitForUsage.pauseUntilReset",
    fields: [
      {
        kind: "switch",
        key: "retry.provider.waitForUsage.pauseUntilReset",
        label: "Wait for the reset",
        help: "Pause, then resume on its own once the limit resets.",
        search: "usage-limit-wait",
      },
      {
        kind: "number",
        key: "retry.provider.waitForUsage.maxPauseMs",
        label: "Longest pause",
        help: "Up to 168 hours, a week.",
        unit: "hours",
        max: 604_800_000,
      },
      {
        kind: "number",
        key: "retry.provider.waitForUsage.maxParks",
        label: "Pauses per limit",
        unit: "count",
        max: 100,
      },
    ],
  },
  {
    id: "images",
    label: "Images",
    fields: [
      {
        kind: "model",
        key: "imageModel",
        label: "Image model",
        help: "Reads the images when the chat model can't. Without one, such messages are refused.",
        none: "None",
        images: true,
        search: "image-model",
      },
      {
        kind: "switch",
        key: "images.autoResize",
        label: "Shrink large images",
        help: "Large images are scaled down before they are sent.",
        search: "shrink-images",
      },
      {
        kind: "switch",
        key: "images.blockImages",
        label: "Block images",
        help: "Images are never sent to a provider.",
        search: "block-images",
      },
    ],
  },
];

const UNITS: Record<Unit, { label: string; scale: number }> = {
  count: { label: "", scale: 1 },
  seconds: { label: "s", scale: 1000 },
  hours: { label: "h", scale: 3_600_000 },
};

export function AgentSettingsPanel() {
  const view = useStore((state) => state.settings.view);
  const actions = useSettingsActions();
  return (
    <SettingsPageContainer>
      <AgentRestartNotice />
      {view === null ? (
        <p className="px-3 text-sm text-muted-foreground sm:px-4">Reading the settings…</p>
      ) : (
        GROUPS.map((group) => {
          const gated = group.gate !== undefined && actions.value(group.gate) === false;
          return (
            <SettingsSection key={group.id} id={group.id} title={group.label}>
              {group.help ? (
                <p className="px-3 pt-3 text-xs text-muted-foreground sm:px-4">{group.help}</p>
              ) : null}
              {group.fields.map((field) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  // The gate itself stays live; the rest dims while it is off.
                  dim={gated && field.key !== group.gate}
                  fallback={view.defaults[field.key]}
                  actions={actions}
                />
              ))}
            </SettingsSection>
          );
        })
      )}
    </SettingsPageContainer>
  );
}

function FieldRow({
  field,
  dim,
  fallback,
  actions,
}: {
  field: Field;
  dim: boolean;
  fallback: unknown;
  actions: SettingsActions;
}) {
  const value = actions.value(field.key);
  const choices = useModelChoices();
  const changed = value !== null && JSON.stringify(value) !== JSON.stringify(fallback ?? null);
  const disabled = !actions.ready;
  const error = actions.errors[field.key];
  let control;
  switch (field.kind) {
    case "switch":
      control = (
        <Switch
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(checked) => actions.write(field.key, Boolean(checked))}
          aria-label={field.label}
        />
      );
      break;
    case "number":
      control = (
        <NumberField
          field={field}
          value={typeof value === "number" ? value : null}
          fallback={typeof fallback === "number" ? fallback : null}
          disabled={disabled}
          write={actions.write}
        />
      );
      break;
    case "model":
      control =
        choices === null ? (
          <span className="text-xs text-muted-foreground">The models show once a session is open.</span>
        ) : (
          <ModelSelect
            label={field.label}
            value={typeof value === "string" ? value : null}
            none={field.none}
            choices={choices.filter((choice) => !field.images || choice.input.includes("image"))}
            disabled={disabled}
            onChange={(next) => actions.write(field.key, next)}
          />
        );
      break;
  }
  return (
    <SettingsRow
      {...(field.search ? searchableSetting(field.search) : {})}
      title={field.label}
      aria-disabled={dim || undefined}
      {...(field.help ? { description: field.help } : {})}
      {...(error ? { status: <span className="text-destructive-foreground">{error}</span> } : {})}
      resetAction={
        changed ? (
          <SettingResetButton
            label={field.label.toLowerCase()}
            disabled={disabled}
            onClick={() => actions.write(field.key, null)}
          />
        ) : null
      }
      control={control}
    />
  );
}

/**
 * A number in its unit, written on Enter or when the field is left; empty puts the
 * default back, which shows as the placeholder.
 */
function NumberField({
  field,
  value,
  fallback,
  disabled,
  write,
}: {
  field: Extract<Field, { kind: "number" }>;
  value: number | null;
  fallback: number | null;
  disabled: boolean;
  write: SettingsActions["write"];
}) {
  const unit = UNITS[field.unit];
  const shown = (stored: number | null) =>
    stored === null ? "" : String(Number((stored / unit.scale).toFixed(3)));
  // Only a value set in the file fills the field; the default is the placeholder.
  const set = value !== null && value !== fallback ? value : null;
  const [text, setText] = useState(shown(set));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(shown(set));
    setInvalid(false);
  }, [set]);

  const commit = () => {
    const typed = text.trim();
    if (typed === "") {
      setInvalid(false);
      if (set !== null) write(field.key, null);
      return;
    }
    const number = Number(typed);
    const stored = Math.round(number * unit.scale);
    const whole = field.unit === "count" ? Number.isInteger(number) : true;
    if (!Number.isFinite(number) || number < 0 || !whole || stored > field.max) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (stored === fallback) {
      setText("");
      if (set !== null) write(field.key, null);
    } else if (stored !== set) {
      write(field.key, stored);
    }
  };

  const input = {
    type: "text",
    inputMode: "decimal" as const,
    "aria-label": field.label,
    "aria-invalid": invalid || undefined,
    placeholder: shown(fallback),
    spellCheck: false,
    disabled,
    value: text,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setText(event.target.value),
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") {
        setText(shown(set));
        setInvalid(false);
      }
    },
  };
  if (!unit.label) return <Input size="sm" className="w-full sm:w-28" {...input} />;
  return (
    <InputGroup className="w-full sm:w-28" data-size="sm">
      <InputGroupInput size="sm" {...input} />
      <InputGroupAddon align="inline-end">
        <span className="text-xs text-muted-foreground">{unit.label}</span>
      </InputGroupAddon>
    </InputGroup>
  );
}
