import { contextBridge, ipcRenderer, webUtils } from "electron";

/** The window's bridge to the main process: the extension's messages both ways, and requests. */
contextBridge.exposeInMainWorld("kuru", {
  post: (message: unknown) => ipcRenderer.send("webview", message),
  onMessage: (listener: (message: unknown) => void) => {
    const wrapped = (_event: unknown, message: unknown) => listener(message);
    ipcRenderer.on("host", wrapped);
    return () => ipcRenderer.removeListener("host", wrapped);
  },
  invoke: (method: string, params?: unknown) => ipcRenderer.invoke("invoke", method, params),
  rpc: (tag: string, payload: unknown) => ipcRenderer.invoke("rpc", tag, payload),
  rpcSubscribe: (id: string, tag: string, payload: unknown) => ipcRenderer.invoke("rpc-subscribe", id, tag, payload),
  rpcUnsubscribe: (id: string) => ipcRenderer.send("rpc-unsubscribe", id),
  onRpcEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, message: unknown) => listener(message);
    ipcRenderer.on("rpc-event", wrapped);
    return () => ipcRenderer.removeListener("rpc-event", wrapped);
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  platform: process.platform,
});

/** T3 Code's desktop bridge, the part its window reads: its theme, and menu actions from the main process. */
contextBridge.exposeInMainWorld("desktopBridge", {
  setTheme: (theme: "light" | "dark" | "system") => ipcRenderer.invoke("desktop:set-theme", theme),
  readMedia: (url: string) => ipcRenderer.invoke("desktop:read-media", url),
  onMenuAction: (listener: (action: string) => void) => {
    const wrapped = (_event: unknown, action: string) => listener(action);
    ipcRenderer.on("menu-action", wrapped);
    return () => ipcRenderer.removeListener("menu-action", wrapped);
  },
});
