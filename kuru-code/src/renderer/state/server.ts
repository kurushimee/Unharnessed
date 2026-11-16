// T3 Code's state/server.ts, the part the window reads: the primary server's
// resolved keybindings. kuru code has T3 Code's default ones.
import type { ResolvedKeybindingsConfig } from "~/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "~/shared/keybindings";

export function readPrimaryServerKeybindings(): ResolvedKeybindingsConfig {
  return DEFAULT_RESOLVED_KEYBINDINGS;
}

export function usePrimaryServerKeybindings(): ResolvedKeybindingsConfig {
  return DEFAULT_RESOLVED_KEYBINDINGS;
}
