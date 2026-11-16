# kuru code: end-to-end checks

Run against the real agent (`target/release/unharnessed.exe`, then the
packaged `resources/bin/unharnessed.exe`), the window driven over CDP
(`--remote-debugging-port=9333`, Playwright `connect_over_cdp`), with
`KURU_USER_DATA=f:/tools/kuru-test-data` and a scratch repository
`f:/tools/kuru-e2e` (`git init`, one commit). 2026-11-16.

| Check | How | Result |
| --- | --- | --- |
| Start | `electron.exe . --remote-debugging-port=9333` | agent `ready`, providers, settings, skills, MCP read; sidebar lists projects and threads from `~/.unharnessed/sessions` |
| Project | `window.kuru.invoke("projects.add", {path: "f:\\tools\\kuru-e2e"})` | project in the sidebar, a draft thread opens in it |
| Turn | composer: "Create a file hello.txt … reply with just: done" + Enter | sidebar row "Working" (and the Working section), then the cell and "done"; `hello.txt` written |
| Git | header button turned "Commit"; dialog, empty message | `git log`: `5f6417d Add a hello.txt greeting file` (message written by the agent) |
| Thread details | header card | path, openers, branch `main`, 1 uncommitted file, context 2.3k / 400k |
| Locked session | open a thread another process holds | the agent's own error and Restart, as in VS Code |
| Pull requests | page, fork with an `upstream` remote | 6 open PRs of unharnessed-agent/Unharnessed; detail, summary markdown, files diff |
| Usage | page, 30 days | 5 threads, 241 replies, 42M input tokens; tokens shown since the model is free |
| Settings | General, Providers, Agent, MCP | prefs saved (theme dark applied); the extension's tabs render and read the agent's settings |
| Quit mid-turn | `window.close()` 6 s into a turn | first run: Electron's error dialog (`Object has been destroyed`) blocked quitting; fixed; now `agent … exited 101 ms after stdin closed`, app gone in 1 s, no orphan `unharnessed.exe` |
| Packaged | `npm run dist`, `release/win-unpacked/kuru-code.exe` | log: `agent …\\resources\\bin\\unharnessed.exe`, built-in skills from `resources/bin/skills`; "Reply with just: pong" answered |
| Installed | `kuru-code-setup-0.1.0.exe /S` | `%LOCALAPPDATA%\\Programs\\kuru-code\\kuru-code.exe`, "kuru code" on the desktop and in the Start menu; starts on the user's data; delete through the context menu removes the session file |
