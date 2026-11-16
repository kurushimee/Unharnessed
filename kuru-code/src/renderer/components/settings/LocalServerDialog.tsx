// A server on this machine and the models picked from it: the extension's local server
// form (vscode/webview/Local.tsx) and its specs editor (ModelSpecsEditor.tsx), as a
// T3 Code dialog. A new one: the usual addresses are looked at first and the first server
// found is filled in, else its address is typed; all its models come switched on. A server
// added: its models are listed again, the ones added switched on.
import { ImageIcon, SlidersHorizontalIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type {
  LocalModel,
  LocalProbe,
  LocalSave,
  LocalServer,
  ModelSpecs,
  Provider,
  TopLevel,
} from "@shared/protocol";
import { post } from "~/bridge";
import { useStore } from "~/state";
import { cn } from "~/lib/utils";
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
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { FieldError } from "./agentSettingsCommon";

/** The row of the server to add. */
export const NEW_LOCAL = "local:new";

/** How long the address rests before the server is asked. */
const PROBE_AFTER_MS = 450;

/** What the agent uses when a count is not set (models.json defaults). */
const DEFAULT_CONTEXT = 128_000;
const DEFAULT_ANSWER = 16_384;
const TOP_LEVELS: TopLevel[] = ["xhigh", "max"];

const keyOf = (url: string, apiKey: string) => `${url.trim()}\n${apiKey.trim()}`;

function tokens(count: number): string {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return String(count);
}

export function LocalServerDialog({
  provider,
  busy,
  error,
  onSave,
  onCancel,
}: {
  /** The server added, when it is one. */
  provider?: Provider;
  busy: boolean;
  error?: string;
  onSave: (server: LocalSave) => void;
  onCancel: () => void;
}) {
  const scanReply = useStore((state) => state.localScan);
  const probeReply = useStore((state) => state.localProbe);
  const added = provider?.local;
  const [url, setUrl] = useState(added?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [probes, setProbes] = useState<ReadonlyMap<string, LocalProbe>>(() => new Map());
  /** The servers at the usual addresses; `null` while they are looked at. */
  const [found, setFound] = useState<LocalServer[] | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(added?.models));
  /** Picks the user made; until then a new server's models are all on. */
  const touched = useRef(added !== undefined);
  /** Specs by model id: saved ones first, then the user's edits. */
  const [specs, setSpecs] = useState<ReadonlyMap<string, ModelSpecs>>(
    () => new Map(Object.entries(added?.specs ?? {})),
  );
  const [edited, setEdited] = useState<ReadonlySet<string>>(() => new Set());
  /** The model whose specs are open. */
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!added) post({ type: "scanLocal" });
  }, [added]);

  useReply(scanReply, ({ servers }) => {
    const list = servers ?? [];
    setFound(list);
    setProbes((probes) => {
      const next = new Map(probes);
      for (const server of list) next.set(keyOf(server.baseUrl, ""), { server });
      return next;
    });
    if (list[0]) setUrl((url) => url || list[0]!.baseUrl);
  });
  useReply(probeReply, ({ baseUrl, apiKey, probe }) => {
    setProbes((probes) => new Map(probes).set(keyOf(baseUrl, apiKey), probe));
  });

  const probe = probes.get(keyOf(url, apiKey));
  const server = probe && "server" in probe ? probe.server : undefined;
  const failure = probe && "error" in probe ? probe.error : undefined;
  // While the scan runs, the address is the scan's to fill.
  const scanning = !added && found === null && !url.trim();

  useEffect(() => {
    if (!url.trim() || probe) return;
    const timer = setTimeout(
      () => post({ type: "probeLocal", baseUrl: url.trim(), apiKey: apiKey.trim() }),
      PROBE_AFTER_MS,
    );
    return () => clearTimeout(timer);
  }, [url, apiKey, probe]);

  useEffect(() => {
    if (server && !touched.current) setPicked(new Set(server.models.map((model) => model.id)));
  }, [server]);

  const choose = (next: string) => {
    if (!added) touched.current = false;
    setUrl(next);
  };
  const again = () => {
    setProbes((probes) => {
      const next = new Map(probes);
      next.delete(keyOf(url, apiKey));
      return next;
    });
  };
  const toggle = (id: string) => {
    touched.current = true;
    setPicked((picked) => {
      const next = new Set(picked);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  const specsOf = (model: LocalModel): ModelSpecs =>
    specs.get(model.id) ?? {
      ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
      image: model.image,
      reasoning: model.reasoning,
      topLevels: [],
    };
  const edit = (id: string, next: ModelSpecs) => {
    setSpecs((specs) => new Map(specs).set(id, next));
    setEdited((edited) => new Set(edited).add(id));
  };

  // The models added that the server does not list (yet) stay, to be switched off.
  const listed = server?.models ?? [];
  const missing = (added?.models ?? []).filter((id) => !listed.some((model) => model.id === id));
  const models: (LocalModel & { missing?: boolean })[] = [
    ...listed,
    ...missing.map((id) => ({ id, image: false, reasoning: false, missing: true })),
  ];
  const kept = added !== undefined && url.trim() === added.baseUrl;
  const ready = picked.size > 0 && (server !== undefined || kept);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    const chosen = models.filter((model) => picked.has(model.id));
    const changed = chosen.filter((model) => edited.has(model.id));
    onSave({
      ...(provider ? { providerId: provider.id } : {}),
      id: server?.id ?? provider?.id ?? "local",
      name: server?.name ?? provider?.name ?? "",
      baseUrl: server?.baseUrl ?? added?.baseUrl ?? url.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      // A model added before keeps its definition: its id is enough.
      models: chosen.map(({ missing, ...model }) => (missing ? { id: model.id } : model)),
      specs: Object.fromEntries(changed.map((model) => [model.id, specsOf(model)])),
    });
  };

  let status: string | null = null;
  if (scanning) status = "Looking for a server on this machine…";
  else if (!url.trim() && !added && found?.length === 0)
    status =
      "No server at the usual addresses. Start Ollama, LM Studio, llama.cpp or vLLM, or enter the address of yours.";
  else if (url.trim() && !probe) status = `Looking at ${url.trim()}…`;
  else if (server && server.models.length === 0) status = `${server.name} serves no model yet.`;

  let label = "Add";
  if (busy) label = "Saving";
  else if (added) label = "Save";
  else if (picked.size > 1) label = `Add ${picked.size} models`;

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogPopup className="max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{provider ? provider.name : "Add a local model"}</DialogTitle>
            <DialogDescription>Ollama, LM Studio, llama.cpp or vLLM, on this machine.</DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-3">
            {!added && found && found.length > 0 ? (
              <ToggleGroup
                aria-label="Servers on this machine"
                variant="segmented"
                className="self-start"
                value={[url.trim()]}
                onValueChange={(next) => next[0] && choose(String(next[0]))}
                disabled={busy}
              >
                {found.map((option) => (
                  <Toggle key={option.baseUrl} value={option.baseUrl}>
                    {option.name}
                  </Toggle>
                ))}
              </ToggleGroup>
            ) : null}
            <Input
              className="font-mono"
              placeholder="http://localhost:11434/v1"
              aria-label="Server address"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              value={url}
              onChange={(event) => choose(event.target.value)}
            />
            {failure?.kind === "needsKey" || apiKey !== "" ? (
              <Input
                type="password"
                placeholder="API key"
                aria-label="API key"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                disabled={busy}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            ) : null}
            {status ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                {scanning || (url.trim() && !probe) ? <Spinner className="size-3" /> : null}
                {status}
              </p>
            ) : null}
            {failure ? (
              <p
                className={cn(
                  "text-xs",
                  failure.kind === "needsKey" ? "text-muted-foreground" : "text-destructive-foreground",
                )}
              >
                {failure.message}
                {failure.kind === "unreachable" ? (
                  <>
                    {" "}
                    <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={again}>
                      Try again
                    </Button>
                  </>
                ) : null}
              </p>
            ) : null}
            {models.length > 0 ? (
              <ul className="max-h-72 overflow-y-auto rounded-lg border" aria-label="Models">
                {models.map((model) => {
                  const shown = specsOf(model);
                  const opened = open === model.id;
                  return (
                    <li key={model.id} className="border-b last:border-b-0">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-sm">{model.id}</span>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                          {model.missing && server
                            ? "not listed"
                            : shown.contextWindow
                              ? tokens(shown.contextWindow)
                              : null}
                          {shown.image ? (
                            <Tooltip>
                              <TooltipTrigger render={<span />}>
                                <ImageIcon className="size-3.5" />
                              </TooltipTrigger>
                              <TooltipPopup side="top">Reads images</TooltipPopup>
                            </Tooltip>
                          ) : null}
                        </span>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                size="icon-xs"
                                variant={opened ? "secondary" : "ghost-muted"}
                                aria-label={`Specs of ${model.id}`}
                                aria-expanded={opened}
                                disabled={busy}
                                onClick={() => setOpen(opened ? null : model.id)}
                              />
                            }
                          >
                            <SlidersHorizontalIcon />
                          </TooltipTrigger>
                          <TooltipPopup side="top">Context, answer length, images, thinking</TooltipPopup>
                        </Tooltip>
                        <Switch
                          checked={picked.has(model.id)}
                          disabled={busy}
                          onCheckedChange={() => toggle(model.id)}
                          aria-label={`Use ${model.id}`}
                        />
                      </div>
                      {opened ? (
                        <ModelSpecsEditor specs={shown} disabled={busy} onChange={(next) => edit(model.id, next)} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <FieldError>{error}</FieldError>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {label}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** Each answer that comes after the dialog opened, once. */
function useReply<T>(reply: T | null, take: (reply: T) => void) {
  const before = useRef(reply);
  const latest = useRef(take);
  latest.current = take;
  useEffect(() => {
    if (reply && reply !== before.current) latest.current(reply);
  }, [reply]);
}

/**
 * A model's specs, set by hand: what a server does not tell. Counts take `400000`,
 * `400k` or `1m`; empty puts the default back.
 */
function ModelSpecsEditor({
  specs,
  disabled,
  onChange,
}: {
  specs: ModelSpecs;
  disabled: boolean;
  onChange: (specs: ModelSpecs) => void;
}) {
  const set = (change: Partial<ModelSpecs>) => onChange({ ...specs, ...change });
  const omit = (key: "contextWindow" | "maxTokens" | "claudeModel", value: number | string | undefined) => {
    const { [key]: _, ...rest } = specs;
    onChange(value === undefined ? rest : { ...rest, [key]: value });
  };
  return (
    <div className="flex flex-col gap-2 border-t bg-muted/40 px-3 py-3">
      <SpecLine label="Context">
        <TokenField
          label="Context window"
          value={specs.contextWindow}
          fallback={DEFAULT_CONTEXT}
          disabled={disabled}
          onChange={(value) => omit("contextWindow", value)}
        />
      </SpecLine>
      <SpecLine label="Longest answer">
        <TokenField
          label="Longest answer"
          value={specs.maxTokens}
          fallback={DEFAULT_ANSWER}
          disabled={disabled}
          onChange={(value) => omit("maxTokens", value)}
        />
      </SpecLine>
      <SpecLine label="Reads images">
        <Switch
          checked={specs.image}
          disabled={disabled}
          onCheckedChange={(image) => set({ image: Boolean(image) })}
          aria-label="Reads images"
        />
      </SpecLine>
      <SpecLine label="Thinks">
        <Switch
          checked={specs.reasoning}
          disabled={disabled}
          onCheckedChange={(reasoning) => set({ reasoning: Boolean(reasoning) })}
          aria-label="Thinks"
        />
      </SpecLine>
      <SpecLine label="Claude model">
        <Tooltip>
          <TooltipTrigger
            render={
              <Input
                size="sm"
                className="w-48 font-mono"
                placeholder="none"
                aria-label="Claude model it stands for"
                autoComplete="off"
                spellCheck={false}
                disabled={disabled}
                value={specs.claudeModel ?? ""}
                onChange={(event) => omit("claudeModel", event.target.value.trim() || undefined)}
              />
            }
          />
          <TooltipPopup side="top">
            Set it (claude-opus-5-5) to ask the model through the server's Anthropic API, as that Claude model
          </TooltipPopup>
        </Tooltip>
      </SpecLine>
      {specs.reasoning ? (
        <SpecLine label="Above high">
          <ToggleGroup
            aria-label="Thinking levels above high"
            variant="segmented"
            multiple
            disabled={disabled}
            value={specs.topLevels}
            onValueChange={(next) =>
              set({ topLevels: TOP_LEVELS.filter((level) => next.includes(level)) })
            }
          >
            {TOP_LEVELS.map((level) => (
              <Toggle key={level} value={level}>
                {level}
              </Toggle>
            ))}
          </ToggleGroup>
        </SpecLine>
      ) : null}
    </div>
  );
}

function SpecLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** A token count, taken when the field is left or on Enter. */
function TokenField({
  label,
  value,
  fallback,
  disabled,
  onChange,
}: {
  label: string;
  value: number | undefined;
  fallback: number;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (!text.trim()) {
      setInvalid(false);
      onChange(undefined);
      return;
    }
    const count = parseTokens(text);
    setInvalid(count === null);
    if (count !== null) {
      setText(String(count));
      onChange(count);
    }
  };
  return (
    <InputGroup className="w-48" data-size="sm">
      <InputGroupInput
        size="sm"
        inputMode="numeric"
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={String(fallback)}
        spellCheck={false}
        disabled={disabled}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <InputGroupAddon align="inline-end">
        <span className="text-xs text-muted-foreground">tokens</span>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** `400000`, `400k`, `1.5m` → a whole positive count, else `null`. */
function parseTokens(text: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([km])?\s*$/i.exec(text.replace(/[_,\s](?=\d)/g, ""));
  if (!match) return null;
  const scale = { k: 1_000, m: 1_000_000 }[match[2]?.toLowerCase() ?? ""] ?? 1;
  const count = Math.round(Number(match[1]) * scale);
  return count > 0 ? count : null;
}
