// The few VS Code types the extension's host modules (../vscode/src) name.
// kuru code runs them in Electron's main process: `vscode` resolves to
// vscode-runtime.ts there.
declare module "vscode" {
  type Thenable<T> = PromiseLike<T>;
  export interface LogOutputChannel {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string | Error, ...args: unknown[]): void;
    debug?(message: string, ...args: unknown[]): void;
    trace?(message: string, ...args: unknown[]): void;
  }
  export class Uri {
    static parse(value: string): Uri;
    static file(path: string): Uri;
    readonly fsPath: string;
    readonly path: string;
    readonly scheme: string;
    toString(skipEncoding?: boolean): string;
  }
  export namespace env {
    const remoteName: string | undefined;
    function openExternal(target: Uri): Thenable<boolean>;
  }
  export namespace workspace {
    const workspaceFolders: { uri: Uri }[] | undefined;
    function getConfiguration(): { get<T>(key: string): T | undefined };
    function findFiles(include: unknown, exclude: unknown, max?: number): Thenable<Uri[]>;
  }
  export namespace window {
    const tabGroups: { all: { tabs: { input: unknown }[] }[] };
  }
  export class TabInputText {
    readonly uri: Uri;
  }
  export class RelativePattern {
    constructor(base: string, pattern: string);
  }
}
