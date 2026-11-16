import type { HostMessage, WebviewMessage } from "@shared/protocol";

type Bridge = {
  post(message: WebviewMessage): void;
  onMessage(listener: (message: HostMessage) => void): () => void;
  invoke<T>(method: string, params?: unknown): Promise<T>;
  pathForFile(file: File): string;
  platform: string;
};

declare global {
  interface Window {
    kuru: Bridge;
  }
}

/** A message to the main process: the extension's, or the app's. */
export function post(message: WebviewMessage): void {
  window.kuru.post(message);
}

export function onHostMessage(listener: (message: HostMessage) => void): () => void {
  return window.kuru.onMessage(listener);
}

/** A request to the main process, answered. */
export function invoke<T>(method: string, params?: unknown): Promise<T> {
  return window.kuru.invoke<T>(method, params);
}
