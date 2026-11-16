// Adapted from T3 Code's lib/discardComposerDraft.ts: drops a thread's unsent
// prompt (or a whole draft thread). T3 Code offers an undo toast; kuru code's
// drafts are only text and images, dropped at once.
import { useComposerDraftStore, type ComposerThreadTarget } from "../composerDraftStore";

export function discardComposerDraft(target: ComposerThreadTarget): void {
  const store = useComposerDraftStore.getState();
  if (typeof target === "string") store.clearDraftThread(target);
  else store.clearComposerDraft(target);
}
