<div align="center">

# ⏱ GTimed

### Run git later — without changing git

[![CI](https://github.com/XreeceX/GTimed/actions/workflows/ci.yml/badge.svg)](https://github.com/XreeceX/GTimed/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-203-2ea44f)](https://github.com/XreeceX/GTimed/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)
[![node](https://img.shields.io/badge/node-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)

<br/>

<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" />
<img alt="Node.js" src="https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white" />
<img alt="Git" src="https://img.shields.io/badge/Git-CLI-F05032?logo=git&logoColor=white" />
<img alt="chrono-node" src="https://img.shields.io/badge/chrono--node-dates-8A2BE2" />
<img alt="cron-parser" src="https://img.shields.io/badge/cron--parser-5-field-orange" />
<img alt="tsx" src="https://img.shields.io/badge/tsx-tests-3178C6" />
<img alt="npm" src="https://img.shields.io/badge/npm-CLI-CB3837?logo=npm&logoColor=white" />
<img alt="GitHub Actions" src="https://img.shields.io/badge/GitHub_Actions-CI-2088FF?logo=githubactions&logoColor=white" />
<img alt="Windows" src="https://img.shields.io/badge/Windows-Task_Scheduler-0078D4?logo=windows&logoColor=white" />
<img alt="macOS / Linux" src="https://img.shields.io/badge/macOS%20%2F%20Linux-cron-000000" />
<img alt="VS Code" src="https://img.shields.io/badge/VS_Code%20%2F%20Cursor-extension-007ACC?logo=visualstudiocode&logoColor=white" />

<p>Schedule a commit, a push, or any other command for later, on a cron, or when the repo looks right.</p>

<p><code>git</code> stays normal. Delay flags live on <code>gtimed</code> only.</p>

[Install](#install) · [Usage](#usage) · [Flags](#flags) · [Conditions](#conditions-when) · [Development](#development)

</div>

---

```bash
gtimed commit --in 20m -m "Hello world"
gtimed push --at "tomorrow 9am"
gtimed --when clean -- git push
```

---

## Install

Node 18+ and `git` on PATH.

```bash
cd GTimed
npm install
npm run build
npm install -g .
gtimed install
```

`npm link` works instead of `npm install -g .`. Open a **new** terminal so `gtimed` is on PATH.

`gtimed install` is a one-off on this machine:

1. Puts `gtimed` on your user PATH.
2. Runs a tick every minute (Task Scheduler on Windows, crontab elsewhere). The PC has to be on and awake.
3. Hooks tab completion.

Uninstall: `gtimed uninstall`, then `npm unlink -g gtimed`.

---

## Usage

```bash
gtimed commit --in 20m -m "fix login"
gtimed push --in 10m
gtimed push --at "tomorrow 9am"
gtimed fetch --cron "0 */4 * * *"
gtimed --when clean -- git push
gtimed --in 30m -- gh pr create --fill
```

```bash
gtimed list              # queue
gtimed --log             # latest job output
gtimed logs <id>
gtimed cancel <id>       # id prefix is enough
gtimed cancel last
gtimed abort             # every pending job
```

### Times

| You type | Meaning |
| --- | --- |
| `--in 30s` | 30 seconds |
| `--in 0.1m` or `--in .1m` | 6 seconds |
| `--in 5m` / `--in 2h` / `--in 1d` | 5 minutes / 2 hours / 1 day |
| `--at "tomorrow 9am"` | local time, via chrono |
| `--at 2026-08-14T09:00` | ISO |

Also: `min`, `minutes`, `hours`, `days`, `weeks`.

### Same command overwrites

A second schedule for the **same command in the same folder** updates the pending job (same id, new time). A different `-m`, remote, or directory is a new job.

```bash
gtimed push --in 20m
gtimed push --in 5m           # updated — fires in 5m
gtimed commit --in 1h -m "a"
gtimed commit --in 10m -m "b" # different message → second job
```

---

## `tick` vs the queue

`gtimed tick` only runs jobs whose time has already arrived.

```text
nothing due to run
still waiting:
  31bc95ae  git push  waiting 2026-08-14T10:45:30.827Z
```

`list` uses the same wording: pending jobs say `waiting …`, finished ones say `ran …`.

After `gtimed install` you don't need to tick by hand. `gtimed run <id>` fires that job now (still checks `--when`).

---

## How commands are parsed

1. Words like `list` / `cancel` / `tick` are GTimed's own.
2. Anything else is a job.
3. Git verbs (`commit`, `push`, `fetch`, …) get `git` stuck on the front.
4. `--in`, `--at`, `--when`, … are pulled out wherever they sit.
5. `--` means "the rest is the command".

```bash
gtimed commit -m "x" --in 1h      # git commit -m x  in 1h
gtimed git push origin main --in 1h
gtimed --in 1h -- git push origin main
gtimed --in 1h -- gh pr create --fill
```

Use `--` if the wrapped tool also has `--in` / `--at` / `--when`.

---

## Flags

Need at least one of `--at`, `--in`, `--cron`, `--when`, or `--now`.

| Flag | Example | Meaning |
| --- | --- | --- |
| `--in` | `--in 30m` | Once, after a duration |
| `--at` | `--at "tomorrow 5pm"` | Once, at that time |
| `--cron` | `--cron "0 18 * * 1-5"` | Each matching minute (stays pending) |
| `--when` | `--when clean` | Repeatable; all must pass at fire time |
| `--until` / `--til` | `--til "Fri 6pm"` | Give up if conditions never match |
| `--now` | `--now` | Run on this invocation (still honors `--when`) |
| `--dry-run` / `--dry` | `--dry` | Log the command, don't spawn it |
| `--same-branch` / `--sb` | `--sb` | Skip if HEAD moved since you scheduled |
| `--cwd` | `--cwd ../other-repo` | Working directory (default: here) |
| `--name` | `--name evening-push` | Label in `gtimed list` |
| `--timeout` / `--to` | `--to 2m` | Kill the process after this |
| `--retry` / `--rt` | `--rt 3` | Extra tries after a non-zero exit |
| `--every` | `--every 15s` | Stored on the job; OS tick is still 1 min / daemon 15s |
| `-h`, `--help` | `gtimed --help` | Show usage, commands, and flags |
| `-V`, `--version` | `gtimed --version` | Print version |

`--at` uses [chrono-node](https://github.com/wanasit/chrono). Cron is 5-field via [cron-parser](https://github.com/harrisiirak/cron-parser).

### Shortcuts

These only apply to `gtimed` itself. The command name stays `gtimed` — we do not install `gt`, because [Graphite](https://graphite.com/docs/install-the-cli) already uses that. Short flags like `--in` / `--at` / `--now` stay as they are. Git's own flags (`-m`, `-a`, `-C`, ffmpeg's `-to`, …) are left alone.

| Long | Short |
| --- | --- |
| `list` | `ls` |
| `tick` | `--tick` |
| `daemon` | `dm` |
| `--timeout` | `--to` |
| `--same-branch` | `--sb` |
| `--dry-run` | `--dry` |
| `--retry` | `--rt` |
| `--until` | `--til` |
| `--when staged` | `--when stg` |
| `--when remote-ok` | `--when ro` |

```bash
gtimed push --in 20m --sb --to 2m --dry
gtimed --tick
```

If a wrapped tool also uses `--to` / `--dry` / `--rt`, put `--` in front of that command.

---

## Conditions (`--when`)

Every spec must pass. Checked in the job's `cwd` when it fires, not when you type it.

| Spec | Passes when |
| --- | --- |
| `clean` | `git status --porcelain` is empty |
| `dirty` | working tree has changes |
| `staged` / `stg` | index has staged files |
| `ahead` | local commits not in upstream (`@{u}..HEAD`) — no fetch |
| `behind` | upstream has commits you don't (`HEAD..@{u}`) — no fetch |
| `remote-ok` / `ro` | `git ls-remote origin HEAD` works |
| `branch=main` | current branch is `main` |
| `file=src/app.ts` | that path is dirty |
| `cmd:<shell>` | command exits `0` |

```bash
gtimed --when clean --when ahead -- git push
gtimed --when branch=main --when remote-ok -- git push
gtimed --when "file=package.json" -- git add package.json
gtimed --when "cmd:npm test" -- git push
gtimed --when dirty --until "tomorrow 6pm" -- git add -A
```

`ahead` / `behind` use the local tracking ref. Pair with `--when remote-ok` or `cmd:git fetch` if you need a fresh remote.

---

## Job commands

```text
gtimed list                 # also: ls
gtimed cancel <id>
gtimed cancel last
gtimed cancel --all
gtimed abort                # same as cancel --all
gtimed logs <id>
gtimed --log                # latest job
gtimed --log <id>           # also: --log last
gtimed run <id>
gtimed tick                 # also: --tick
gtimed daemon               # also: dm  (tick every 15s in this terminal)
gtimed install / uninstall
gtimed completion install
gtimed ui
gtimed help                 # also: -h, --help
gtimed version              # also: -V, --version
```

Statuses: `pending` → `running` → `done` | `failed` | `cancelled` | `skipped`.

Cron jobs go back to `pending` after a success. One-shots become `done`. IDs are 8 hex chars; `gtimed --log abc` is enough if that prefix is unique. Reschedule prints `updated <id>`.

---

## Tab completion

`gtimed install` (or `gtimed completion install`) hooks your shell.

```bash
gtimed ca<Tab>              # cancel
gtimed --i<Tab>             # --in
gtimed commit --w<Tab>      # --when
gtimed --when c<Tab>        # clean / cmd:
gtimed cancel <Tab>         # job ids
```

| Shell | Hook |
| --- | --- |
| PowerShell | `$PROFILE` |
| bash / Git Bash | `~/.bashrc` if it exists |
| zsh | `~/.zshrc` if it exists |
| fish | `~/.config/fish/completions/gtimed.fish` |

New terminal after install. Dump a script with `gtimed completion powershell`. Completion is for `gtimed` only, not `git`.

---

## UI

```bash
gtimed ui
gtimed ui --port 8787 --cwd . --no-open
```

Localhost only (`http://127.0.0.1:8787`): stage files, type a message, pick Now / In / At / Cron, optional push.

The folder `vscode-extension/` adds clock / upload buttons next to Git's Commit. See [vscode-extension/README.md](vscode-extension/README.md).

---

## How a tick decides to run

1. Load pending jobs.
2. `--until` already past → `failed`.
3. `--at` / `--in` must be due; `--cron` must match this minute (once per minute).
4. `--when` must pass, or it stays pending.
5. `--same-branch` and the branch moved → `skipped`.
6. Run in the saved `cwd` with your normal env (ssh-agent, Git Credential Manager, …).
7. Non-zero exit: retry if attempts remain, else `failed`.

`--dry-run` logs `would execute …` and counts as success.

Queue: `~/.gtimed/jobs.json` (`GTIMED_HOME` to override). Logs: `~/.gtimed/logs/<id>.log`.

---

## Safety

- A scheduled push uses this machine, your remotes, your credentials, at fire time. Not GitHub Actions.
- Nothing is snapshotted. Extra commits you make before a delayed push are included. A delayed commit uses whatever is staged **then**.
- `cmd:` is a shell. Don't put commands you don't trust in it.
- No confirm prompt. `gtimed push --in 1m` will push.

Sleeping laptops don't fire until the next tick after wake. `--every` is stored but does not change the OS timer.

---

## Development

```bash
npm install
npm run build
npm test          # 203 tests (Ubuntu, Windows, macOS × Node 18, 20, and 22)
npx tsx src/index.ts --help
```

```text
src/               CLI, parser, tick, store, tests
ui/                browser panel for gtimed ui
vscode-extension/  SCM buttons
```

Similar ideas: [Git-Schedule](https://github.com/mafex11/Git-Schedule), [GitLater](https://github.com/prakratt/GitLater), [grony](https://github.com/luismedel/grony). Those tend to special-case commit or push. This one wraps any command and can wait on repo state.

---

## License

[MIT](LICENSE)
