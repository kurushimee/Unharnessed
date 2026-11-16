// The providers: the extension's Providers screen (vscode/webview/Providers.tsx), shown as
// T3 Code shows its settings. Every provider the agent knows, in four groups: connected,
// the servers on this machine (local), subscriptions (a browser sign-in) and API keys (a
// key pasted here).
import { PlusIcon, SearchIcon, UnlinkIcon } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Provider, WebviewMessage } from "@shared/protocol";
import { post } from "~/bridge";
import { useStore } from "~/state";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { FieldError, ProviderIcon, providerSettingsRowId } from "./agentSettingsCommon";
import { LocalServerDialog, NEW_LOCAL } from "./LocalServerDialog";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** From this many rows on, a search field filters them. */
const SEARCH_FROM = 9;

/**
 * The open dialog: its key, the confirmation before a sign-in that replaces a
 * credential, the one before a disconnect, or a local server's.
 */
type Open = { id: string; method: Provider["method"]; mode: "key" | "signin" | "disconnect" | "local" };

type Run = (message: WebviewMessage) => void;

/** How a row is connected, or why it is not. */
function status(provider: Provider): ReactNode {
  const { note } = provider;
  if (provider.connected) {
    let how: string;
    if (note?.startsWith("env: ")) how = `with ${note.slice(5)} from your environment`;
    else if (note) how = `via ${note}`;
    else how = provider.method === "subscription" ? "with your subscription" : "with a saved API key";
    return (
      <span className="flex items-center gap-1.5">
        <Badge variant="success" size="sm">
          Connected
        </Badge>
        {how}
      </span>
    );
  }
  switch (note) {
    case "subscription configured":
      return "The subscription sign-in is used instead";
    case "API key configured":
      return "The saved API key is used instead";
    case "expired":
      return <span className="text-warning-foreground">Sign-in expired</span>;
    default:
      return note;
  }
}

export function ProvidersSettingsPanel() {
  const providers = useStore((state) => state.providers);
  const result = useStore((state) => state.providerResult);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // The main process answers each key save, disconnect or local server change.
  useEffect(() => {
    if (!result) return;
    setBusy(false);
    if (result.error) setError(result.error);
    else {
      setOpen(null);
      setError(undefined);
    }
  }, [result]);

  if (!providers) {
    return (
      <SettingsPageContainer>
        <p className="px-3 text-sm text-muted-foreground sm:px-4">Reading the providers…</p>
      </SettingsPageContainer>
    );
  }

  const show = (next: Open | null) => {
    setOpen(next);
    setBusy(false);
    setError(undefined);
  };
  const run: Run = (message) => {
    setBusy(true);
    setError(undefined);
    post(message);
  };
  const login = (provider: Provider) => {
    show(null);
    post({ type: "login", providerId: provider.id });
  };
  // Anthropic and xAI: the other kind of credential, in the same slot.
  const otherOf = (provider: Provider) =>
    providers.find((p) => p.id === provider.id && p.method !== provider.method && p.connected);

  const words = query.trim().toLowerCase();
  const shown = words
    ? providers.filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(words))
    : providers;
  const servers = shown.filter((p) => p.local);
  const others = shown.filter((p) => !p.local);
  const groups: [string, string, Provider[]][] = [
    ["providers-connected", "Connected", others.filter((p) => p.connected)],
    ["providers-subscriptions", "Subscriptions", others.filter((p) => !p.connected && p.method === "subscription")],
    ["providers-api-keys", "API keys", others.filter((p) => !p.connected && p.method === "apiKey")],
  ];
  // A provider's first row carries its id, for links to it (the model picker's "Set up").
  const anchored = new Set<string>();
  const anchor = (id: string) => {
    if (anchored.has(id)) return {};
    anchored.add(id);
    return { id: providerSettingsRowId(id) };
  };
  const openProvider = open
    ? providers.find((p) => p.id === open.id && p.method === open.method)
    : undefined;

  const group = ([id, label, rows]: [string, string, Provider[]]) =>
    rows.length > 0 ? (
      <SettingsSection key={id} id={id} title={label}>
        {rows.map((provider) => {
          const other = otherOf(provider);
          const browser = provider.login === "browser";
          // A sign-in that would replace a working credential asks first.
          const activate = () => {
            if (!browser) show({ id: provider.id, method: provider.method, mode: "key" });
            else if (provider.connected || other)
              show({ id: provider.id, method: provider.method, mode: "signin" });
            else login(provider);
          };
          return (
            <SettingsRow
              key={`${provider.id}/${provider.method}`}
              {...anchor(provider.id)}
              title={
                <span className="flex items-center gap-2">
                  <ProviderIcon providerId={provider.id} name={provider.name} local={false} />
                  {provider.name}
                </span>
              }
              {...(provider.warning
                ? { description: <span className="text-warning-foreground">{provider.warning}</span> }
                : {})}
              status={status(provider)}
              control={
                <>
                  <Button size="xs" variant="outline" onClick={activate}>
                    {browser
                      ? provider.connected
                        ? "Sign in again"
                        : "Sign in"
                      : provider.connected
                        ? "Replace key"
                        : "Add key"}
                  </Button>
                  {provider.removable ? (
                    <Button
                      size="icon-xs"
                      variant="ghost-destructive"
                      aria-label={`Disconnect ${provider.name}`}
                      onClick={() => show({ id: provider.id, method: provider.method, mode: "disconnect" })}
                    >
                      <UnlinkIcon />
                    </Button>
                  ) : null}
                </>
              }
            />
          );
        })}
      </SettingsSection>
    ) : null;

  return (
    <SettingsPageContainer>
      <div {...searchableSetting("providers")} className="flex flex-col gap-3 px-3 sm:px-4">
        {!providers.some((provider) => provider.connected) ? (
          <div>
            <h2 className="text-base font-semibold text-foreground">Connect a provider</h2>
            <p className="text-sm text-muted-foreground">
              Sign in with a subscription, add an API key, or use a model on this machine.
            </p>
          </div>
        ) : null}
        {providers.length >= SEARCH_FROM ? (
          <InputGroup data-size="sm">
            <InputGroupAddon>
              <SearchIcon className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              size="sm"
              type="search"
              placeholder="Search providers"
              aria-label="Search providers"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
        ) : null}
      </div>
      {group(groups[0]!)}
      {!words || servers.length > 0 ? (
        <SettingsSection
          {...searchableSetting("local-models")}
          title="Local"
          headerAction={
            words ? null : (
              <Button
                size="xs"
                variant="outline"
                onClick={() => show({ id: NEW_LOCAL, method: "apiKey", mode: "local" })}
              >
                <PlusIcon />
                Add a local model
              </Button>
            )
          }
        >
          {servers.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
              Ollama, LM Studio, llama.cpp or vLLM, running on this machine.
            </p>
          ) : (
            servers.map((provider) => (
              <SettingsRow
                key={provider.id}
                {...anchor(provider.id)}
                title={
                  <span className="flex items-center gap-2">
                    <ProviderIcon providerId={provider.id} name={provider.name} local />
                    {provider.name}
                  </span>
                }
                description={provider.local?.models.join(", ")}
                control={
                  <>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => show({ id: provider.id, method: provider.method, mode: "local" })}
                    >
                      Models
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost-destructive"
                      aria-label={`Remove ${provider.name}`}
                      onClick={() => show({ id: provider.id, method: provider.method, mode: "disconnect" })}
                    >
                      <UnlinkIcon />
                    </Button>
                  </>
                }
              />
            ))
          )}
        </SettingsSection>
      ) : null}
      {groups.slice(1).map(group)}
      {shown.length === 0 ? (
        <p className="px-3 text-sm text-muted-foreground sm:px-4">No provider matches “{query.trim()}”.</p>
      ) : null}

      {open?.mode === "local" ? (
        <LocalServerDialog
          {...(openProvider ? { provider: openProvider } : {})}
          busy={busy}
          {...(error ? { error } : {})}
          onSave={(server) => run({ type: "saveLocal", rowId: open.id, server })}
          onCancel={() => show(null)}
        />
      ) : null}
      {open?.mode === "key" && openProvider ? (
        <KeyDialog
          provider={openProvider}
          other={otherOf(openProvider)}
          busy={busy}
          error={error}
          onSave={(apiKey) => run({ type: "setApiKey", providerId: openProvider.id, apiKey })}
          onCancel={() => show(null)}
        />
      ) : null}
      {open?.mode === "signin" && openProvider ? (
        <ConfirmDialog
          title={openProvider.connected ? `Sign in to ${openProvider.name} again?` : `Sign in to ${openProvider.name}?`}
          description={
            openProvider.connected
              ? `You are signed in to ${openProvider.name}. Sign in again to switch accounts or renew the sign-in.`
              : otherOf(openProvider)?.removable
                ? `Signing in replaces the saved ${otherOf(openProvider)?.name} API key.`
                : `Once you are signed in, the subscription is used instead of the ${otherOf(openProvider)?.name} API key.`
          }
          action={openProvider.connected ? "Sign in again" : "Sign in"}
          onConfirm={() => login(openProvider)}
          onCancel={() => show(null)}
        />
      ) : null}
      {open?.mode === "disconnect" && openProvider ? (
        <ConfirmDialog
          title={
            openProvider.local
              ? `Remove ${openProvider.name}?`
              : openProvider.method === "subscription"
                ? `Sign out of ${openProvider.name}?`
                : `Remove the saved ${openProvider.name} API key?`
          }
          {...(openProvider.local ? { description: "Its models leave the model menu." } : {})}
          action={openProvider.local ? "Remove" : "Disconnect"}
          destructive
          busy={busy}
          error={error}
          onConfirm={() =>
            run(
              openProvider.local
                ? { type: "removeLocal", providerId: openProvider.id }
                : { type: "logout", providerId: openProvider.id },
            )
          }
          onCancel={() => show(null)}
        />
      ) : null}
    </SettingsPageContainer>
  );
}

function ConfirmDialog({
  title,
  description,
  action,
  destructive = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: string;
  action: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {error ? (
          <DialogPanel>
            <FieldError>{error}</FieldError>
          </DialogPanel>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={busy} onClick={onConfirm}>
            {action}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function KeyDialog({
  provider,
  other,
  busy,
  error,
  onSave,
  onCancel,
}: {
  provider: Provider;
  other: Provider | undefined;
  busy: boolean;
  error: string | undefined;
  onSave: (apiKey: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const empty = value.trim() === "";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!empty && !busy) onSave(value);
  };

  // What saving does to the key already in use.
  let replaces: string | undefined;
  if (provider.connected && provider.note?.startsWith("env: ")) {
    replaces = `${provider.note.slice(5)} from your environment is in use. A key saved here is used instead.`;
  } else if (provider.connected && provider.removable) {
    replaces = "A key is saved. A new one replaces it.";
  } else if (other) {
    replaces = `Saving a key replaces the ${other.name} sign-in.`;
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogPopup>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{provider.name} API key</DialogTitle>
            {replaces ? <DialogDescription>{replaces}</DialogDescription> : null}
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-3">
            <Input
              type="password"
              placeholder={`${provider.name} API key`}
              aria-label={`${provider.name} API key`}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              disabled={busy}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <FieldError>{error}</FieldError>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={empty || busy}>
              {busy ? "Saving" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
