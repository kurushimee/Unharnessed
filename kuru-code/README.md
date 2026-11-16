# kuru code

A Windows desktop app for the Unharnessed agent. Its interface is taken from
[T3 Code](https://github.com/pingdotgg/t3code) (MIT): the sidebar of projects
and threads, the thread header with its git control and details card, the
Pull requests and Usage pages, Settings. Inside a thread, the conversation,
the composer, the kernel tray and the agent's settings are the VS Code
extension's panel (`../vscode/webview`), restyled with T3 Code's theme; the
main process drives one agent per thread with the extension's host modules
(`../vscode/src`). The agent itself (the binary, its ACP protocol, its
settings in `~/.unharnessed`) is unchanged.

## Commands

    npm install
    npm run build      # main process (esbuild) and window (Vite) into dist/
    npm start          # runs the built app with the repository's target/release agent
    npm run dev        # Vite with hot reload; restart Electron for main-process changes
    npm run dist       # cargo build --release, then the per-user installer in release/

`KURU_USER_DATA` points the app's own data (projects, preferences, window,
log) elsewhere; `UNHARNESSED_BIN` picks another agent binary.

## What comes from where

- `src/main/`: the Electron main process: threads (`threads.ts`), projects
  and preferences (`store.ts`), git and GitHub through `git`/`gh` (`git.ts`),
  the Usage page's figures from the session files (`usage.ts`) and the
  subscriptions' limits (`limits.ts`).
- `src/renderer/components/ui/`: T3 Code's primitives (Base UI, Tailwind).
- `src/renderer/components/`: the T3 Code shell, rewritten on the app's state.
- `@panel/*` (`../vscode/webview`): the extension's chat, composer, settings
  tabs, providers and sign-in, unchanged; `panelHost.ts` stands in for the
  webview API and `panel.css` maps its tokens onto T3 Code's.
