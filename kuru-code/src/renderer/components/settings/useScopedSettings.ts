// Adapted from T3 Code's components/settings/useScopedSettings.ts. kuru code has one
// environment, this machine, and no settings scopes: every setting is read from and
// written to it (the client part to the client settings, the rest to kuru/serverConfig.ts).
import type { UnifiedSettings } from "~/contracts";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";

export function useScopedSettings<T = UnifiedSettings>(
  selector?: (settings: UnifiedSettings) => T,
): T {
  return usePrimarySettings(selector);
}

export function useUpdateScopedSettings() {
  return useUpdatePrimarySettings();
}
