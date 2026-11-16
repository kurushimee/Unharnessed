// T3 Code's lib/terminalFocus.ts, the part kuru code needs: whether focus is
// in a terminal. kuru code has no terminals (Unharnessed runs commands
// itself), so this is always false, and the shortcut contexts read the same.
export type TerminalFocusOwner = "drawer" | "right-panel";

export function getTerminalFocusOwner(): TerminalFocusOwner | null {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return null;
  if (!activeElement.isConnected) return null;
  const owner = activeElement.closest<HTMLElement>("[data-terminal-owner]")?.dataset.terminalOwner;
  if (owner === "drawer" || owner === "right-panel") return owner;
  return null;
}

export function isTerminalFocused(): boolean {
  return getTerminalFocusOwner() !== null;
}

export function subscribeToTerminalFocusChanges(listener: () => void): () => void {
  window.addEventListener("focusin", listener, true);
  window.addEventListener("focusout", listener, true);
  return () => {
    window.removeEventListener("focusin", listener, true);
    window.removeEventListener("focusout", listener, true);
  };
}
