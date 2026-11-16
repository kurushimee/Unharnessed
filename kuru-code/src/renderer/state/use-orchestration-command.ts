// T3 Code's state/use-orchestration-command.ts runs a command through its
// atom registry, reporting failures as toasts unless told not to. kuru code's
// commands are plain calls to its main process, so this returns the command.
import type { OrchestrationCommand } from "./threads";

export function useOrchestrationCommand<I>(
  command: OrchestrationCommand<I>,
  _options: { readonly reportFailure?: boolean } = {},
): OrchestrationCommand<I> {
  return command;
}
