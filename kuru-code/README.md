# kuru code

A Windows desktop app for the Unharnessed agent. Its interface is T3 Code's
web app ([pingdotgg/t3code](https://github.com/pingdotgg/t3code), MIT, see
`LICENSE.t3code`), with the code copied and edited in place: the sidebar of
projects and threads, the thread view with its composer, model picker,
timeline, find and details card, the Pull requests and Usage pages, and the
Settings window. T3 Code's server, remote environments, terminal, preview,
device sync and its other features that Unharnessed does not have are cut.
Settings carry the VS Code extension's controls (providers, agent, MCP
servers, skills, instructions) drawn as T3 Code settings pages. The main
process drives one agent per thread with the extension's host modules
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
  the Usage page's figures from the session files (`usage.ts`), the
  subscriptions' limits (`limits.ts`), and the renderer's RPC (`rpc.ts`).
- `src/renderer/`: T3 Code's `apps/web/src`, file for file
  (`T3_ORIGIN.json` maps each file to its source); `contracts/` and `rt/`
  hold the parts of T3 Code's `packages/` it needs.
- `src/renderer/kuru/`: what replaces T3 Code's server: the projection of
  Unharnessed sessions into T3 Code's thread state, providers, settings and
  keybindings.
- `@panel/mentions` (`../vscode/webview`): the extension's `@` path ranking.
- Settings > About > Open source licenses lists every bundled dependency;
  `scripts/licenses.mjs` writes that list at build time.
