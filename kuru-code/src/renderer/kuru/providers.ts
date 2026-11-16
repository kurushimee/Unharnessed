// Unharnessed's providers as T3 Code's server providers. T3 Code's providers
// are coding agents (Codex, Claude...) each with its models; kuru code drives
// one agent, Unharnessed, and what a thread's model comes from is one of
// Unharnessed's providers (OpenAI, Anthropic, a local server...). Each becomes
// a T3 Code provider: its models are the session's model choices from it, the
// current model's reasoning effort and fast mode its option descriptors (the
// ACP `thought_level` and `fast_mode` options T3 Code's composer shows), and
// its usage limits those kuru code reads (kuru/limits.ts).
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ServerProvider,
  type ServerProviderModel,
  type ServerProviderUsageLimits,
} from "~/contracts";
import type { ModelChoice, Provider, SessionState } from "@shared/protocol";
import { useStore, type Store } from "~/state";

import { setServerProvidersSource } from "./serverConfig";

/** The T3 Code driver whose icon and name an Unharnessed provider shows. */
export function driverKindOfProvider(providerId: string, local: boolean): ProviderDriverKind {
  const id = providerId.toLowerCase();
  if (local) return ProviderDriverKind.make("openaiCompatible");
  if (id.startsWith("anthropic") || id.startsWith("claude")) return ProviderDriverKind.make("claudeAgent");
  if (id.includes("codex") || id.startsWith("openai") || id.startsWith("chatgpt")) return ProviderDriverKind.make("codex");
  if (id.startsWith("openrouter")) return ProviderDriverKind.make("openrouter");
  if (id.startsWith("ollama")) return ProviderDriverKind.make("ollama");
  if (id.startsWith("google") || id.startsWith("gemini") || id.startsWith("antigravity"))
    return ProviderDriverKind.make("antigravity");
  if (id.startsWith("xai") || id.startsWith("grok")) return ProviderDriverKind.make("grok");
  return ProviderDriverKind.make("openaiCompatible");
}

/** A model's id inside its instance: Unharnessed names it `provider/model`. */
export function modelSlug(choice: Pick<ModelChoice, "id">): string {
  return choice.id;
}

function effortLabel(level: string): string {
  return level === "xhigh" ? "Extra high" : level.charAt(0).toUpperCase() + level.slice(1);
}

/** The current model's pickers, as T3 Code's option descriptors. */
function currentDescriptors(session: SessionState | null): ReadonlyArray<ProviderOptionDescriptor> {
  if (session?.kind !== "open") return [];
  const descriptors: ProviderOptionDescriptor[] = [];
  const effort = session.config.effort;
  if (effort && effort.levels.length > 0) {
    descriptors.push({
      id: "thought_level",
      label: "Reasoning",
      type: "select",
      role: "reasoning",
      currentValue: effort.current,
      options: effort.levels.map((level) => ({
        id: level,
        label: effortLabel(level),
        ...(level === effort.current ? { isDefault: true } : {}),
      })),
    });
  }
  if (session.config.fast !== null) {
    descriptors.push({ id: "fast_mode", label: "Fast mode", type: "boolean", currentValue: session.config.fast });
  }
  return descriptors;
}

const CHECKED_AT = new Date(0).toISOString();

function toProvider(
  id: string,
  provider: Provider | undefined,
  choices: ReadonlyArray<ModelChoice>,
  current: string | null,
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  limits: ServerProviderUsageLimits | undefined,
): ServerProvider {
  const models: ServerProviderModel[] = choices.map((choice) => ({
    slug: modelSlug(choice),
    name: choice.name || choice.id,
    isCustom: provider?.local !== undefined,
    ...(choice.value === current ? { isDefault: true } : {}),
    capabilities: choice.value === current && descriptors.length > 0 ? { optionDescriptors: descriptors } : null,
  }));
  const connected = provider?.connected ?? true;
  return {
    instanceId: ProviderInstanceId.make(id),
    driver: driverKindOfProvider(id, provider?.local !== undefined),
    displayName: provider?.name || id,
    enabled: connected,
    installed: true,
    version: null,
    status: connected ? "ready" : "disabled",
    auth: {
      status: connected ? "authenticated" : "unauthenticated",
      ...(provider ? { type: provider.method === "subscription" ? "subscription" : "apiKey" } : {}),
      ...(provider?.removable ? { canLogout: true } : {}),
    },
    checkedAt: CHECKED_AT,
    ...(provider?.note ? { message: provider.note } : {}),
    models,
    slashCommands: [],
    skills: [],
    supportsConversationRollback: true,
    reportsContextWindow: true,
    ...(limits ? { usageLimits: limits } : {}),
  };
}

let usageLimitsSource: () => ReadonlyMap<string, ServerProviderUsageLimits> = () => new Map();
/** Where the providers' usage limits come from; set by kuru/limits.ts. */
export function setUsageLimitsSource(source: () => ReadonlyMap<string, ServerProviderUsageLimits>): void {
  usageLimitsSource = source;
  built = null;
}

let built: { providers: unknown; session: unknown; limits: unknown; value: ReadonlyArray<ServerProvider> } | null = null;

/** Unharnessed's providers as T3 Code's; the same state gives the same array. */
export function serverProvidersOf(state: Pick<Store, "providers" | "session">): ReadonlyArray<ServerProvider> {
  const limits = usageLimitsSource();
  if (built && built.providers === state.providers && built.session === state.session && built.limits === limits) {
    return built.value;
  }
  const session = state.session;
  const model = session?.kind === "open" ? session.config.model : null;
  const choices = model?.choices ?? [];
  const current = model?.current ?? null;
  const descriptors = currentDescriptors(session);
  const ids: string[] = [];
  for (const provider of state.providers ?? []) if (!ids.includes(provider.id)) ids.push(provider.id);
  for (const choice of choices) if (!ids.includes(choice.provider)) ids.push(choice.provider);
  const value = ids.map((id) =>
    toProvider(
      id,
      state.providers?.find((provider) => provider.id === id),
      choices.filter((choice) => choice.provider === id),
      current,
      descriptors,
      limits.get(id),
    ),
  );
  built = { providers: state.providers, session: state.session, limits, value };
  return value;
}

/** Feeds kuru code's server config its providers. */
export function startProviders(): void {
  setServerProvidersSource(() => serverProvidersOf(useStore.getState()));
}
