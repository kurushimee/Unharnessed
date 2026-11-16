// Adapted from T3 Code's client-runtime providerClients.ts. T3 Code ships a
// client per coding agent it drives (Codex, Claude, Cursor...); kuru code
// drives Unharnessed, whose providers are model APIs. Each driver kind kuru
// code gives an Unharnessed provider (kuru/providers.ts) has its client here,
// named as Unharnessed names the provider, with T3 Code's model families so
// short model names read as T3 Code's do.
import { isProviderDriverKind, ProviderDriverKind } from "~/contracts";
import * as Schema from "effect/Schema";
import { makeProviderClientRegistry, type ProviderSettingsSchema } from "./providerCore/client";
import { modelShortName } from "./providerCore/modelShortName";

export { openRouterIcon } from "./providerIcons";

const NO_SETTINGS = Schema.Struct({}) as unknown as ProviderSettingsSchema;

export const providerClients = makeProviderClientRegistry([
  { driverKind: ProviderDriverKind.make("codex"), label: "OpenAI", modelFamilies: ["GPT-", "GPT "], settingsSchema: NO_SETTINGS },
  { driverKind: ProviderDriverKind.make("claudeAgent"), label: "Anthropic", modelFamilies: ["Claude "], settingsSchema: NO_SETTINGS },
  { driverKind: ProviderDriverKind.make("antigravity"), label: "Google", modelFamilies: ["Gemini "], settingsSchema: NO_SETTINGS },
  { driverKind: ProviderDriverKind.make("grok"), label: "xAI", modelFamilies: ["Grok "], settingsSchema: NO_SETTINGS },
  { driverKind: ProviderDriverKind.make("openrouter"), label: "OpenRouter", settingsSchema: NO_SETTINGS },
  { driverKind: ProviderDriverKind.make("ollama"), label: "Ollama", settingsSchema: NO_SETTINGS },
  { driverKind: ProviderDriverKind.make("openaiCompatible"), label: "Local server", settingsSchema: NO_SETTINGS },
]);

export function getProviderClient(driver: string | null | undefined) {
  return isProviderDriverKind(driver) ? providerClients.get(driver) : undefined;
}

export function resolveModelShortName(
  model: { readonly name: string; readonly shortName?: string | undefined },
  driverKind: ProviderDriverKind | null | undefined,
): string | undefined {
  if (model.shortName) return model.shortName;
  const families = driverKind ? providerClients.get(driverKind)?.modelFamilies : undefined;
  return modelShortName(model.name, families ?? []);
}
