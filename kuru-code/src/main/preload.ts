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
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  platform: process.platform,
});
