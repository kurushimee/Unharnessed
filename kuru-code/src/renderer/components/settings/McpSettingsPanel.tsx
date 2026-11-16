// The MCP servers: the extension's MCP tab (vscode/webview/SettingsMcp.tsx), shown as
// T3 Code shows its settings. Yours (the `mcpServers` setting and the services you added),
// then the Marketplace, Prime's catalog of services to add in one click.
import { PlusIcon, SearchIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type { McpServer } from "@shared/protocol";
import { post } from "~/bridge";
import { useStore } from "~/state";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { AgentRestartNotice, DialogField, FieldError } from "./agentSettingsCommon";
import { useSettingsActions, useSettled, type SettingsActions } from "./settingsActions";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** One entry of the `mcpServers` setting, as the file holds it. */
type ServerConfig = Record<string, unknown>;

/** The name the agent addresses a server by. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** The open dialog: a server of yours by name, a new one, or a Marketplace token. */
type Open = { kind: "server"; id: string } | { kind: "new" } | { kind: "token"; id: string };

export function McpSettingsPanel() {
  const servers = useStore((state) => state.settings.mcp);
  const saved = useStore(
    (state) => (state.settings.view?.values.mcpServers ?? {}) as Record<string, ServerConfig>,
  );
  const actions = useSettingsActions();
  const [open, setOpen] = useState<Open | null>(null);
  const config = (actions.value("mcpServers") ?? {}) as Record<string, ServerConfig>;

  if (!servers) {
    return (
      <SettingsPageContainer>
        <p className="px-3 text-sm text-muted-foreground sm:px-4">Reading the MCP servers…</p>
      </SettingsPageContainer>
    );
  }

  const listed = new Map(servers.map((server) => [server.id, server]));
  // The file's servers, a server being added before the list has it, and the ones a
  // workspace's settings add; not one being removed.
  const yours = [
    ...Object.keys(config),
    ...servers
      .filter(
        (server) => server.source === "user" && !(server.id in config) && !(server.id in saved),
      )
      .map((server) => server.id),
  ];
  // A catalog service is yours once signed in, or its token stored.
  const services = servers.filter((server) => server.source === "catalog" && server.signedIn);
  const market = servers
    .filter((server) => server.source === "catalog" && !server.signedIn)
    .toSorted((a, b) => a.label.localeCompare(b.label));
  const save = (previous: string | null, id: string, next: ServerConfig) => {
    const map = { ...config };
    if (previous !== null && previous !== id) delete map[previous];
    map[id] = next;
    actions.write("mcpServers", map);
  };
  const signOut = (id: string) => actions.act(`mcp:${id}`, true, { type: "mcpSignOut", id });
  const remove = (id: string) => {
    const { [id]: _, ...rest } = config;
    actions.write("mcpServers", rest);
    if (listed.get(id)?.signedIn) signOut(id);
    setOpen(null);
  };
  const editing = open?.kind === "server" ? open.id : null;
  const editServer = editing !== null ? listed.get(editing) : undefined;
  const tokenFor = open?.kind === "token" ? listed.get(open.id) : undefined;

  return (
    <SettingsPageContainer>
      <AgentRestartNotice />
      <SettingsSection
        {...searchableSetting("mcp-servers")}
        title="Your servers"
        headerAction={
          <Button size="xs" variant="outline" disabled={!actions.ready} onClick={() => setOpen({ kind: "new" })}>
            <PlusIcon />
            Add server
          </Button>
        }
      >
        <p className="px-3 pt-3 text-xs text-muted-foreground sm:px-4">
          The agent calls MCP servers' tools from its Python kernel. Changes apply when it restarts.
        </p>
        {yours.length === 0 && services.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">No server yet.</p>
        ) : null}
        {yours.map((id) => (
          <UserServerRow
            key={id}
            id={id}
            server={listed.get(id)}
            config={config[id]}
            actions={actions}
            onEdit={() => setOpen({ kind: "server", id })}
            onEnable={(on) => {
              const { enabled: _, ...rest } = config[id] ?? {};
              save(id, id, on ? rest : { ...rest, enabled: false });
            }}
            onSignOut={() => signOut(id)}
          />
        ))}
        {services.map((server) => (
          <SettingsRow
            key={server.id}
            title={server.label}
            description={server.description}
            status={<ServerStatus server={server} />}
            control={<SignInActions server={server} actions={actions} onSignOut={() => signOut(server.id)} />}
          />
        ))}
        {actions.errors.mcpServers && open === null ? (
          <div className="px-3 pb-3 sm:px-4">
            <FieldError>{actions.errors.mcpServers}</FieldError>
          </div>
        ) : null}
      </SettingsSection>
      <Marketplace
        services={market}
        none={!servers.some((server) => server.source === "catalog")}
        actions={actions}
        onToken={(id) => setOpen({ kind: "token", id })}
      />
      {open?.kind === "new" || editing !== null ? (
        <ServerDialog
          key={editing ?? "+"}
          {...(editing !== null
            ? {
                id: editing,
                ...(config[editing] ? { config: config[editing] } : {}),
                ...(editServer ? { server: editServer } : {}),
              }
            : {})}
          taken={Object.keys(config)}
          actions={actions}
          onSave={(name, next) => save(editing, name, next)}
          {...(editing !== null && config[editing] ? { onRemove: () => remove(editing) } : {})}
          onDone={() => setOpen(null)}
        />
      ) : null}
      {tokenFor?.token ? (
        <TokenDialog service={tokenFor} label={tokenFor.token} actions={actions} onDone={() => setOpen(null)} />
      ) : null}
    </SettingsPageContainer>
  );
}

/** What the server's state comes to, for its row. */
function ServerStatus({ server }: { server: McpServer | undefined }): ReactNode {
  if (!server) return "Saving";
  switch (server.status) {
    case "disabled":
      return "Off";
    case "connected":
      // Nothing to sign in to: the agent reaches it when it needs it.
      return server.source === "user" && !server.signedIn ? (
        "Ready"
      ) : (
        <Badge variant="success" size="sm">Connected</Badge>
      );
    case "pending":
      return <Badge variant="success" size="sm">Signed in</Badge>;
    case "not_connected":
      return server.signIn ? "Not signed in" : (server.hint ?? "Not connected");
    default:
      return <span className="text-warning-foreground">{server.hint ?? "Needs setup"}</span>;
  }
}

/** Where a server is: its URL's host, or its command. */
function target(config: ServerConfig | undefined): string | undefined {
  if (!config) return undefined;
  if (config.type === "stdio") return typeof config.command === "string" ? config.command : undefined;
  try {
    return new URL(String(config.url)).host;
  } catch {
    return undefined;
  }
}

/** The sign-in, or the sign-out, a server offers. */
function SignInActions({
  server,
  actions,
  onSignOut,
}: {
  server: McpServer;
  actions: SettingsActions;
  onSignOut: () => void;
}) {
  const busy = `mcp:${server.id}` in actions.drafts;
  if (!server.signIn && !server.signedIn) return null;
  return (
    <>
      {server.signIn ? (
        <Button
          size="xs"
          variant="outline"
          disabled={!actions.ready}
          // The sign-in dialog takes over until it is done.
          onClick={() => post({ type: "mcpSignIn", id: server.id, label: server.label })}
        >
          {server.signedIn ? "Sign in again" : "Sign in"}
        </Button>
      ) : null}
      {server.signedIn ? (
        <Button size="xs" variant="destructive-outline" disabled={!actions.ready || busy} onClick={onSignOut}>
          {busy ? "Signing out" : "Sign out"}
        </Button>
      ) : null}
    </>
  );
}

function UserServerRow({
  id,
  server,
  config,
  actions,
  onEdit,
  onEnable,
  onSignOut,
}: {
  id: string;
  server: McpServer | undefined;
  /** `undefined`: set in a workspace's settings, not here. */
  config: ServerConfig | undefined;
  actions: SettingsActions;
  onEdit: () => void;
  onEnable: (on: boolean) => void;
  onSignOut: () => void;
}) {
  const where = target(config);
  const error = actions.errors[`mcp:${id}`];
  return (
    <SettingsRow
      title={<span className="font-mono">{id}</span>}
      description={config ? where : "Set in a workspace's settings, not here."}
      status={
        <span className="flex flex-col gap-1">
          <ServerStatus server={server} />
          <FieldError>{error}</FieldError>
        </span>
      }
      control={
        <>
          {!config && server ? <SignInActions server={server} actions={actions} onSignOut={onSignOut} /> : null}
          {config ? (
            <>
              <Button size="xs" variant="outline" disabled={!actions.ready} onClick={onEdit}>
                Edit
              </Button>
              <Switch
                checked={config.enabled !== false}
                disabled={!actions.ready}
                onCheckedChange={(checked) => onEnable(Boolean(checked))}
                aria-label={`Use ${id}`}
              />
            </>
          ) : null}
        </>
      }
    />
  );
}

/** Prime's catalog, the services not added yet, A to Z. */
function Marketplace({
  services,
  none,
  actions,
  onToken,
}: {
  services: ReadonlyArray<McpServer>;
  /** No catalog at all: it could not be read. */
  none: boolean;
  actions: SettingsActions;
  onToken: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();
  const shown = services.filter((service) => !words || found(service, words));
  return (
    <SettingsSection
      id="mcp-marketplace"
      title="Marketplace"
      headerAction={
        none ? null : (
          <InputGroup className="w-48 sm:w-56" data-size="sm">
            <InputGroupAddon>
              <SearchIcon className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              size="sm"
              type="search"
              placeholder={`Search ${services.length} services`}
              aria-label="Search the Marketplace"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
        )
      }
    >
      {none ? (
        <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
          The Marketplace could not be read. It is tried again within the hour.
        </p>
      ) : shown.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
          {words ? "No service matches." : "Every service is added."}
        </p>
      ) : (
        shown.map((service) => {
          const busy = `mcp:${service.id}` in actions.drafts;
          // Nothing to add it by: what it needs instead.
          const blocked = !service.signIn && !service.token;
          return (
            <SettingsRow
              key={service.id}
              title={service.label}
              description={service.description}
              {...(blocked ? { status: service.hint ?? "Cannot be added" } : {})}
              control={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!actions.ready || blocked || busy}
                  onClick={() =>
                    service.token
                      ? onToken(service.id)
                      : post({ type: "mcpSignIn", id: service.id, label: service.label })
                  }
                >
                  Add
                </Button>
              }
            />
          );
        })
      )}
    </SettingsSection>
  );
}

/** Whether the service answers to the words: its name, other names, category or publisher. */
function found(service: McpServer, words: string): boolean {
  return [service.label, service.id, ...(service.aliases ?? []), service.category, service.publisher].some(
    (text) => text?.toLowerCase().includes(words),
  );
}

/** The token a Marketplace service is added by; it is checked with the service first. */
function TokenDialog({
  service,
  label,
  actions,
  onDone,
}: {
  service: McpServer;
  label: string;
  actions: SettingsActions;
  onDone: () => void;
}) {
  const [token, setToken] = useState("");
  const key = `mcp:${service.id}`;
  const busy = key in actions.drafts;
  // Once taken, the service is yours: its row leaves the Marketplace.
  const sent = useSettled(key, actions, onDone);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed || busy) return;
    sent();
    actions.act(key, true, { type: "mcpSetToken", id: service.id, token: trimmed });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogPopup>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add {service.label}</DialogTitle>
            {service.description ? <DialogDescription>{service.description}</DialogDescription> : null}
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-3">
            <DialogField label={label}>
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                disabled={busy}
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </DialogField>
            <FieldError>{actions.errors[key]}</FieldError>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={!token.trim() || busy || !actions.ready}>
              {busy ? "Adding" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

type Kind = "http" | "stdio";
type Auth = "none" | "oauth" | "variable";

/**
 * A server's details: by URL (with its sign-in) or by command (with the variables it
 * gets). Fields the dialog does not show (headers, tool filters, timeouts) are kept as
 * the file has them.
 */
function ServerDialog({
  id,
  config,
  server,
  taken,
  actions,
  onSave,
  onRemove,
  onDone,
}: {
  /** `undefined`: a new server. */
  id?: string;
  config?: ServerConfig;
  server?: McpServer;
  /** Names already in use. */
  taken: ReadonlyArray<string>;
  actions: SettingsActions;
  onSave: (id: string, config: ServerConfig) => void;
  onRemove?: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(id ?? "");
  const [kind, setKind] = useState<Kind>(config?.type === "stdio" ? "stdio" : "http");
  const [url, setUrl] = useState(typeof config?.url === "string" ? config.url : "");
  const [auth, setAuth] = useState<Auth>(
    typeof config?.bearerTokenEnvVar === "string" ? "variable" : config?.oauth === true ? "oauth" : "none",
  );
  const [variable, setVariable] = useState(
    typeof config?.bearerTokenEnvVar === "string" ? config.bearerTokenEnvVar : "",
  );
  const [command, setCommand] = useState(commandLine(config));
  const [passed, setPassed] = useState(envLine(config));
  const [removing, setRemoving] = useState(false);
  const sent = useSettled("mcpServers", actions, onDone);
  const busy = "mcpServers" in actions.drafts;

  const trimmed = name.trim();
  let problem: string | undefined;
  if (trimmed && !NAME.test(trimmed))
    problem = "A name is letters, digits, - and _, starting with a letter or digit.";
  else if (trimmed !== id && taken.includes(trimmed)) problem = `There is a server named ${trimmed} already.`;
  const words = splitCommand(command);
  const complete =
    trimmed !== "" &&
    (kind === "http" ? url.trim() !== "" && (auth !== "variable" || variable.trim() !== "") : words.length > 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!complete || problem || busy) return;
    // Start from the file's entry: what the dialog does not show stays.
    const next: ServerConfig = { ...config };
    for (const field of ["url", "oauth", "bearerTokenEnvVar", "headers", "command", "args", "cwd", "env"]) {
      delete next[field];
    }
    next.type = kind;
    if (kind === "http") {
      next.url = url.trim();
      if (config?.type !== "stdio" && config?.headers) next.headers = config.headers;
      if (auth === "oauth") next.oauth = true;
      if (auth === "variable") next.bearerTokenEnvVar = variable.trim();
    } else {
      next.command = words[0];
      if (words.length > 1) next.args = words.slice(1);
      if (config?.type === "stdio" && config.cwd) next.cwd = config.cwd;
      const env = parseEnv(passed);
      if (Object.keys(env).length > 0) next.env = env;
    }
    sent();
    onSave(trimmed, next);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogPopup>
        {removing ? (
          <>
            <DialogHeader>
              <DialogTitle>Remove {id}?</DialogTitle>
              {server?.signedIn ? <DialogDescription>Its sign-in goes too.</DialogDescription> : null}
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRemoving(false)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={!actions.ready} onClick={onRemove}>
                Remove
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{id === undefined ? "Add an MCP server" : id}</DialogTitle>
              {server?.hint && server.status !== "not_connected" ? (
                <DialogDescription>{server.hint}</DialogDescription>
              ) : null}
            </DialogHeader>
            <DialogPanel className="flex flex-col gap-4">
              <DialogField label="Name">
                <Input
                  placeholder="e.g. docs"
                  spellCheck={false}
                  autoFocus={id === undefined}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </DialogField>
              <Choice
                label="Reached by"
                value={kind}
                options={[
                  ["http", "URL"],
                  ["stdio", "Command"],
                ]}
                onChange={setKind}
              />
              {kind === "http" ? (
                <>
                  <DialogField label="URL">
                    <Input
                      className="font-mono"
                      placeholder="e.g. https://mcp.example.com/mcp"
                      spellCheck={false}
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                    />
                  </DialogField>
                  <Choice
                    label="Sign-in"
                    value={auth}
                    options={[
                      ["none", "None"],
                      ["oauth", "OAuth"],
                      ["variable", "Token variable"],
                    ]}
                    onChange={setAuth}
                  />
                  {auth === "oauth" ? (
                    <p className="text-xs text-muted-foreground">Once saved, sign in from its row.</p>
                  ) : null}
                  {auth === "variable" ? (
                    <DialogField label="Variable holding the token">
                      <Input
                        className="font-mono"
                        placeholder="e.g. DOCS_TOKEN"
                        spellCheck={false}
                        value={variable}
                        onChange={(event) => setVariable(event.target.value)}
                      />
                    </DialogField>
                  ) : null}
                </>
              ) : (
                <>
                  <DialogField label="Command">
                    <Input
                      className="font-mono"
                      placeholder="e.g. npx -y @modelcontextprotocol/server-github"
                      spellCheck={false}
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                    />
                  </DialogField>
                  <DialogField
                    label="Variables it gets"
                    help="From your environment, separated by spaces; it gets PATH and HOME anyway. NAME=OTHER passes OTHER as NAME."
                  >
                    <Input
                      className="font-mono"
                      placeholder="e.g. GITHUB_TOKEN"
                      spellCheck={false}
                      value={passed}
                      onChange={(event) => setPassed(event.target.value)}
                    />
                  </DialogField>
                </>
              )}
              <FieldError>{problem}</FieldError>
              <FieldError>{actions.errors.mcpServers}</FieldError>
            </DialogPanel>
            <DialogFooter>
              {onRemove ? (
                <Button type="button" variant="destructive-outline" className="sm:me-auto" onClick={() => setRemoving(true)}>
                  Remove
                </Button>
              ) : null}
              <Button type="button" variant="ghost" onClick={onDone}>
                Cancel
              </Button>
              <Button type="submit" disabled={!complete || !!problem || busy || !actions.ready}>
                {busy ? "Saving" : id === undefined ? "Add" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogPopup>
    </Dialog>
  );
}

/** A choice of a few, as a segmented control. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <ToggleGroup
        aria-label={label}
        variant="segmented"
        className="self-start"
        value={[value]}
        onValueChange={(next) => {
          const picked = options.find(([option]) => option === next[0]);
          if (picked) onChange(picked[0]);
        }}
      >
        {options.map(([option, text]) => (
          <Toggle key={option} value={option}>
            {text}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** The command and its arguments as one line, quoted where needed. */
function commandLine(config: ServerConfig | undefined): string {
  if (config?.type !== "stdio" || typeof config.command !== "string") return "";
  const args = Array.isArray(config.args) ? config.args.map(String) : [];
  return [config.command, ...args]
    .map((word) => (/^[^\s"'\\]+$/.test(word) ? word : JSON.stringify(word)))
    .join(" ");
}

/** Words split on spaces; quotes keep spaces in, a backslash keeps the next character. */
function splitCommand(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: string | null = null;
  let started = false;
  for (let at = 0; at < line.length; at++) {
    const char = line[at]!;
    if (char === "\\" && at + 1 < line.length && quote !== "'") {
      word += line[++at];
      started = true;
    } else if (quote) {
      if (char === quote) quote = null;
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (started) words.push(word);
  return words;
}

/** The `env` entries as `NAME`, or `NAME=OTHER` when another variable feeds it. */
function envLine(config: ServerConfig | undefined): string {
  if (config?.type !== "stdio" || !config.env || typeof config.env !== "object") return "";
  return Object.entries(config.env as Record<string, { env?: string }>)
    .map(([name, from]) => (from?.env && from.env !== name ? `${name}=${from.env}` : name))
    .join(" ");
}

function parseEnv(line: string): Record<string, { env: string }> {
  const env: Record<string, { env: string }> = {};
  for (const word of line.split(/[\s,]+/).filter(Boolean)) {
    const [name, from] = word.split("=", 2);
    if (name) env[name] = { env: from || name };
  }
  return env;
}
