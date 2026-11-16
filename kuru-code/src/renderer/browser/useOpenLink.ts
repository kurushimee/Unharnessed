import { readLocalApi } from "~/localApi";

/** Opens a link in the system browser. */
export function openExternalLink(url: string): Promise<void> {
  const api = readLocalApi();
  if (!api) return Promise.reject(new Error("Link opening is unavailable."));
  return api.shell.openExternal(url);
}
