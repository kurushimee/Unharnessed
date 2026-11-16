// Adapted from T3 Code's providerInstances.ts. T3 Code's provider instances are
// the coding agents it drives (Codex, Claude...); kuru code drives one agent,
// Unharnessed, whose providers (OpenAI, Anthropic, a local server...) are what
// a thread's model comes from. Each Unharnessed provider is an instance here,
// with the driver kind whose T3 Code icon fits it.
import { useStore } from "~/state";
import type { ProviderInstanceId } from "~/contracts";
import { normalizeProviderAccentColor, shouldShowInstanceBadge } from "~/rt/state/providerInstanceDisplay";

export { normalizeProviderAccentColor, shouldShowInstanceBadge };

export type ProviderDriverKind = string;

export interface ProviderModelEntry {
  readonly slug: string;
  readonly name: string;
  readonly shortName?: string | undefined;
  readonly subProvider?: string | undefined;
  readonly isDefault?: boolean | undefined;
}

export interface ProviderInstanceEntry {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly accentColor?: string | undefined;
  readonly acpRegistryAgentId?: string | undefined;
  readonly acpRegistryIconUrl?: string | undefined;
  readonly enabled: boolean;
  readonly models: ReadonlyArray<ProviderModelEntry>;
}

/** The T3 Code driver whose icon an Unharnessed provider shows. */
export function driverKindOfProvider(providerId: string, local: boolean): ProviderDriverKind {
  if (local) return "openaiCompatible";
  const id = providerId.toLowerCase();
  if (id.startsWith("anthropic") || id.startsWith("claude")) return "claudeAgent";
  if (id.includes("codex") || id.startsWith("openai") || id.startsWith("chatgpt")) return "codex";
  if (id.startsWith("openrouter")) return "openrouter";
  if (id.startsWith("ollama")) return "ollama";
  if (id.startsWith("google") || id.startsWith("gemini") || id.startsWith("antigravity"))
    return "antigravity";
  return "openaiCompatible";
}

type StoreSlice = Pick<ReturnType<typeof useStore.getState>, "providers" | "session">;
let built: { providers: unknown; session: unknown; map: ReadonlyMap<string, ProviderInstanceEntry> } | null =
  null;

export function providerEntriesOf(state: StoreSlice): ReadonlyMap<string, ProviderInstanceEntry> {
  if (built && built.providers === state.providers && built.session === state.session) return built.map;
  const choices = state.session?.kind === "open" ? (state.session.config.model?.choices ?? []) : [];
  const map = new Map<string, ProviderInstanceEntry>();
  for (const provider of state.providers ?? []) {
    if (map.has(provider.id)) continue;
    map.set(provider.id, {
      instanceId: provider.id as ProviderInstanceId,
      driverKind: driverKindOfProvider(provider.id, provider.local !== undefined),
      displayName: provider.local ? provider.name || provider.id : provider.name,
      enabled: provider.connected,
      models: choices
        .filter((choice) => choice.provider === provider.id)
        .map((choice) => ({ slug: choice.id, name: choice.name })),
    });
  }
  // Models of providers the list does not name still show under their own id.
  for (const choice of choices) {
    if (map.has(choice.provider)) continue;
    map.set(choice.provider, {
      instanceId: choice.provider as ProviderInstanceId,
      driverKind: driverKindOfProvider(choice.provider, false),
      displayName: choice.provider,
      enabled: true,
      models: choices
        .filter((other) => other.provider === choice.provider)
        .map((other) => ({ slug: other.id, name: other.name })),
    });
  }
  built = { providers: state.providers, session: state.session, map };
  return map;
}

export function useProviderEntryByInstanceId(): ReadonlyMap<string, ProviderInstanceEntry> {
  const providers = useStore((state) => state.providers);
  const session = useStore((state) => state.session);
  return providerEntriesOf({ providers, session });
}
