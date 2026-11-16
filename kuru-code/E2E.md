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
| Replayed turn times | open thread `01a1e3c7…` ("try searching the internet"; file: user message `09:54:30.257Z`, last reply `09:54:46.637Z`) | before: `"turnEnd":{"state":"done"}`, header "Worked for 1ms"; after: `"turnStart":{…,"at":1794822870257}`, `"turnEnd":{"state":"done","ms":16380}`, header "Worked for 16s" |
| Command palette | Ctrl+K | Actions (New thread in …, New thread in…, without a project, Add project, theme, appearance, theme editor, pull requests, usage); typing "searching" lists the thread by title and two by message ("In messages") |
| Add project, browse | palette › Add project | opens on `~/` with the home folder's directories (main `filesystem.browse`); `f:/tools/kuru-e2e` + Enter on a known project opens a new thread in it |
| Add project, create | palette › Add project, `f:/tools/kuru-e2e-new` | button reads "Create & Add"; Enter: folder made, `state.json` gains `f:\tools\kuru-e2e-new` (resolved), header `kuru-e2e-new / New thread`, details card "Initialize Git" |
| New thread, shortcut | Ctrl+Shift+N in a thread | `#/draft/<id>`, "What should we build in kuru-e2e?" |
| First turn of a draft | "Reply with just the word ping." + Enter | one user message (before: the window's copy stayed beside the turn's), "ping"; route moves to `#/local/<same id>` (before: stayed on `#/draft/…`) |
| Turn times, later turns | three turns in one thread | 4.3s, 3.6s, 4.8s kept on each (before: an earlier turn read "Worked for 1ms" once a later one started) |
| Pull requests, T3 Code's service | `KURU_USER_DATA=f:/tools/kuru-test-data`, project `f:\Unharnessed` (remotes `origin` kurushimee, `upstream` unharnessed-agent), `#/pull-requests` | main's `pullRequests.list` (src/main/t3, `gh auth token`): "Others 7", #5 #4 #9 #3 #2 #8 #6 of unharnessed-agent/Unharnessed with +/- counts |
| Pull request detail | click #8 | Summary (description markdown, reviewers, labels, "No checks reported"), Timeline (commit `c3afaa1`, "Pull request opened"), Code: 11 files; first run the diff stayed blank (`CompileError: WebAssembly.Module()` against CSP `script-src 'self'`); CSP gained `'wasm-unsafe-eval'`, now highlighted hunks |
| Files viewed | Code › "Viewed" on `compact_session.rs`, reload | "1 / 11 viewed" kept after reload (GitHub's own mark); unticked again |
| Check out | clone `f:\tools\uh-pr-test` as the only project of the repo, #5 › Check out | `git branch --show-current`: `fix/models-json-per-model-compat` at `c9d26397`; new draft thread in uh-pr-test, details card with the branch and "#5: models.json: …" |
| Usage limits | `#/usage` › Limits, no subscription signed in (`auth.json` absent) | "No provider reports subscription limits."; refresh: `limits.get` answered `[]`, no console error; Tokens tab: 589M, 7 sessions (the environment filter is gone from the breadcrumb) |
| Local images | `window.kuru.rpc('assets.createUrl', draft-workspace-file resources/icon.png)` then `fetch()` | `[200, "image/png", 8940]` (file is 8940 bytes); first run: CORS refused `kuru-asset:` from `file://`, fixed with `corsEnabled` + `Access-Control-Allow-Origin`; `../secret.txt`: `AssetWorkspacePathValidationError` |
| Local image in a reply | kuru-e2e thread: "Reply with exactly this markdown line and nothing else: ![icon](f:/Unharnessed/kuru-code/resources/icon.png)" | the icon drawn in the user message and in the reply (before: `assets.createUrl` unanswered, no image) |
| Project search | `projects.searchEntries` cwd kuru-code, "assets", limit 5 | `src/renderer/assets` (folder), `src/main/assets.ts`, … `truncated: true` |
| Rewind | kuru-e2e thread (ping, then the icon prompt) › hover the icon prompt › pencil "Edit from here" › dialog "Edit from here?" (Cancel / Rewind, no "Revert files too") › Rewind | log: `_unharnessed/session/rewind {"to":"068676b8"}`, `chat: back to before turn 2`; the prompt and reply leave the timeline, the prompt text is in the composer; first run: no pencil until a reload (the rewindable set was read outside the atoms), fixed with an atom |
| After a rewind | send "Quote my previous message to you exactly, nothing else." | reply "Reply with just the word ping." (the rewound prompt is gone from the agent's conversation too) |
| Queued message | kuru-e2e thread: "Run this in bash: sleep 30; echo done. Then reply with just: finished." (Enter), then "Reply with just the word beta." with Ctrl+Enter (queue) | dashed queued row "Reply with just the word beta." with pencil and ×; log `chat: queued (1 waiting)` |
| Edit queued message | pencil "Edit queued message" › composer holds "beta" ("Editing in the composer") › Ctrl+A, "Reply with just the word gamma.", Enter | log `waiting message 11 back in the message box to change`, `waiting message 11 changed (31 chars, 0 images)`; after "finished", the next turn is "Reply with just the word gamma." › "gamma"; first run: "Could not save the edited queued message" (the main process was not restarted after the build), then the message steered by Enter showed as queued too (steering messages left out of the queued runs now) |
| Cell cut off by a restart | kill kuru code while "sleep 40" runs in the kuru-e2e thread, relaunch (log `chat: kernel restored`, `kernel/changed … "commands":[]`) | before: a "Running · sleep 40; echo done · 4m 26s · Details · Stop" row stayed under the timeline (the cell of the ended turn was still projected as running); after: no background row, the cell is projected `interrupted` |
| Limits after the reset-credit cut | Usage › Limits; `window.kuru.invoke('limits.get')` | `[]` (`~/.unharnessed/auth.json` is `{}`: no ChatGPT or Claude sign-in), "No provider reports subscription limits."; the bars themselves are not exercised: the preload's `window.kuru` cannot be replaced to feed fake limits (`replaced false`) |
