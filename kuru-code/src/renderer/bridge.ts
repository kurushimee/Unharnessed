import type { HostMessage, WebviewMessage } from "@shared/protocol";

/** A value, or the end, of a stream the main process answers (rt/rpc/client.ts). */
export type RpcEvent = { id: string; value?: unknown; end?: true; error?: unknown };

type Bridge = {
  post(message: WebviewMessage): void;
  onMessage(listener: (message: HostMessage) => void): () => void;
  invoke<T>(method: string, params?: unknown): Promise<T>;
  rpc(tag: string, payload: unknown): Promise<unknown>;
  rpcSubscribe(id: string, tag: string, payload: unknown): Promise<unknown>;
  rpcUnsubscribe(id: string): void;
  onRpcEvent(listener: (event: RpcEvent) => void): () => void;
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
  // Thrown across the context bridge, an error loses its stack; say it here.
  return window.kuru.onMessage((message) => {
    try {
      listener(message);
    } catch (error) {
      console.error(`kuru: the window could not take the main process's "${message.type}"`, error);
    }
  });
}

/** A request to the main process, answered. */
export function invoke<T>(method: string, params?: unknown): Promise<T> {
  return window.kuru.invoke<T>(method, params);
}

export function rpcBridge() {
  return window.kuru;
}
