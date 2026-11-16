// What the extension's host modules (../vscode/src) take from `vscode` at
// run time, in Electron's main process. Only `env` is reached: a sign-in
// page opens in the browser (providers.ts). The rest exists so the modules
// load; kuru code never calls it (files.ts has its own here, files.ts).
import { shell } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";

export class Uri {
  private constructor(private readonly value: string) {}
  static parse(value: string): Uri {
    return new Uri(value);
  }
  static file(path: string): Uri {
    return new Uri(pathToFileURL(path).href);
  }
  get scheme(): string {
    return this.value.split(":", 1)[0];
  }
  get path(): string {
    return new URL(this.value).pathname;
  }
  get fsPath(): string {
    return fileURLToPath(this.value);
  }
  toString(): string {
    return this.value;
  }
}

export const env = {
  remoteName: undefined as string | undefined,
  async openExternal(target: Uri): Promise<boolean> {
    await shell.openExternal(target.toString());
    return true;
  },
};

export const workspace = {
  workspaceFolders: undefined,
  getConfiguration: () => ({ get: () => undefined }),
  findFiles: async () => [],
};

export const window = { tabGroups: { all: [] } };
export class TabInputText {}
export class RelativePattern {
  constructor(_base: string, _pattern: string) {}
}
