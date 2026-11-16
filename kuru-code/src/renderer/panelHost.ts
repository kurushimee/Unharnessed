// The extension panel's `./vscode` (vscode/webview/vscode.ts), in the app:
// messages go through the bridge; the draft is kept per thread by the main
// process, so nothing is saved here.
export { onHostMessage, post } from "./bridge";

export function savedDraft(): string {
  return "";
}

export function saveDraft(_text: string): void {}
