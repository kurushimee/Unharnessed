// Pieces the agent's settings pages share: the restart notice, a model choice and the
// provider icon, in T3 Code's controls.
import { RotateCcwIcon } from "lucide-react";
import type { ModelChoice, Provider } from "@shared/protocol";
import { post } from "~/bridge";
import { useStore } from "~/state";
import { driverKindOfProvider } from "~/kuru/providers";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

/** The provider's connected row: Anthropic and xAI have a subscription row and a key row. */
function providerRow(providers: ReadonlyArray<Provider>, id: string): Provider | undefined {
  return providers.find((p) => p.id === id && p.connected) ?? providers.find((p) => p.id === id);
}

export function providerName(providers: ReadonlyArray<Provider>, id: string): string {
  return providerRow(providers, id)?.name ?? id;
}

/** The id of a provider's row on the providers page, to jump to it. */
export function providerSettingsRowId(providerId: string): string {
  return `provider-${providerId}`;
}

export function isLocalProvider(providers: ReadonlyArray<Provider>, id: string): boolean {
  return providers.some((p) => p.id === id && p.local !== undefined);
}

export function ProviderIcon({
  providerId,
  name,
  local,
  className,
}: {
  providerId: string;
  name: string;
  local: boolean;
  className?: string;
}) {
  return (
    <ProviderInstanceIcon
      driverKind={driverKindOfProvider(providerId, local)}
      displayName={name}
      size="compact"
      {...(className ? { className } : {})}
    />
  );
}

/** The session's models; `null` until a session is open. */
export function useModelChoices(): ReadonlyArray<ModelChoice> | null {
  return useStore((state) =>
    state.session?.kind === "open" ? (state.session.config.model?.choices ?? null) : null,
  );
}

export function modelKey(choice: Pick<ModelChoice, "provider" | "id">): string {
  return `${choice.provider}/${choice.id}`;
}

/** Some of the settings apply when the agent restarts; it offers the restart. */
export function AgentRestartNotice() {
  const pending = useStore((state) => state.settings.pending.length > 0);
  const ready = useStore((state) => state.agent?.kind === "ready");
  if (!pending) return null;
  return (
    <Alert variant="info">
      <AlertDescription>Some changes apply when the agent restarts.</AlertDescription>
      <AlertAction>
        <Button size="xs" variant="outline" disabled={!ready} onClick={() => post({ type: "restartAgent" })}>
          <RotateCcwIcon />
          {ready ? "Restart agent" : "Restarting"}
        </Button>
      </AlertAction>
    </Alert>
  );
}

const NONE = "__none__";

/** A model setting: one of the session's models, by provider, or `none`. */
export function ModelSelect({
  label,
  value,
  none,
  choices,
  disabled,
  onChange,
}: {
  label: string;
  value: string | null;
  /** What no model means, as the first option; absent: a model must be chosen. */
  none?: string;
  choices: ReadonlyArray<ModelChoice>;
  disabled?: boolean;
  onChange: (key: string | null) => void;
}) {
  const providers = useStore((state) => state.providers) ?? [];
  const current = choices.find((choice) => modelKey(choice) === value);
  const byProvider = new Map<string, ModelChoice[]>();
  for (const choice of choices) {
    byProvider.set(choice.provider, [...(byProvider.get(choice.provider) ?? []), choice]);
  }
  const groups = [...byProvider.entries()].toSorted(([left], [right]) =>
    providerName(providers, left).localeCompare(providerName(providers, right)),
  );
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(next) => onChange(next === NONE || next === null ? null : String(next))}
      {...(disabled ? { disabled } : {})}
    >
      <SelectTrigger size="sm" className="w-full sm:w-64" aria-label={label}>
        <SelectValue>
          {current ? (
            <span className="flex min-w-0 items-center gap-2">
              <ProviderIcon
                providerId={current.provider}
                name={providerName(providers, current.provider)}
                local={isLocalProvider(providers, current.provider)}
              />
              <span className="truncate">{current.name}</span>
            </span>
          ) : (
            (value ?? none ?? "Choose a model")
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false} className="max-h-96">
        {none !== undefined ? (
          <SelectItem hideIndicator value={NONE}>
            {none}
          </SelectItem>
        ) : null}
        {groups.map(([provider, models]) => (
          <SelectGroup key={provider}>
            <SelectGroupLabel>{providerName(providers, provider)}</SelectGroupLabel>
            {models.map((choice) => (
              <SelectItem hideIndicator key={modelKey(choice)} value={modelKey(choice)}>
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderIcon
                    providerId={choice.provider}
                    name={providerName(providers, choice.provider)}
                    local={isLocalProvider(providers, choice.provider)}
                  />
                  <span className="truncate">{choice.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** A labelled field of a settings dialog, with its help under it. */
export function DialogField({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {help ? <span className="text-xs text-muted-foreground">{help}</span> : null}
    </label>
  );
}

export function FieldError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <p className="text-xs text-destructive-foreground">{children}</p>;
}
