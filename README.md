# GTimed

Schedule **git** (or any other CLI) for later, on a cron, or when a repo condition matches.

GitHub and `git` have no delay flags. GTimed is a separate command:

```bash
gtimed commit --in 20m -m "Hello world"
gtimed push --at "tomorrow 9am"
gtimed --when clean -- git push
```

`git` itself is unchanged. `--in`, `--at`, `--when`, and `--cron` work on **`gtimed` only**.

---

## Install (once)

Needs Node.js 18+ and `git` on PATH.

```bash
cd GTimed
npm install
npm run build
npm install -g .
gtimed install
```

(`npm link` works instead of `npm install -g .`.) Open a **new** terminal, then `gtimed` should be on PATH.

`gtimed install` is machine setup. After that, jobs keep firing when Cursor is closed:

1. Puts `gtimed` on your user PATH (npm global bin).
2. Registers **Windows Task Scheduler** (or crontab) to run a tick **every minute** and **at logon**. The PC must be **on and awake**.
3. Installs **tab completion** for `gtimed`.

Uninstall: `gtimed uninstall`, then `npm unlink -g gtimed`.

---

## Everyday use

```bash
gtimed commit --in 20m -m "fix login"
gtimed push --in 10m
gtimed push --at "tomorrow 9am"
gtimed fetch --cron "0 */4 * * *"
gtimed --when clean -- git push
gtimed --in 30m -- gh pr create --fill
```

Then:

```bash
gtimed list              # queue
gtimed logs <id>         # output of a job
gtimed --log             # latest job's log
gtimed cancel <id>       # abort one (id prefix is enough)
gtimed cancel last
gtimed abort             # abort every pending job
```

### Durations and times

| What you type | Meaning |
| --- | --- |
| `--in 30s` | 30 seconds |
| `--in 0.1m` or `--in .1m` | 6 seconds |
| `--in 5m` / `--in 2h` / `--in 1d` | 5 minutes / 2 hours / 1 day |
| `--at "tomorrow 9am"` | chrono phrase (local time) |
| `--at 2026-08-14T09:00` | ISO time |

Also: `min`, `minutes`, `hours`, `days`, `weeks`.

### Same command overwrites

If a **pending** job already exists for the **same command in the same folder**, a new schedule **replaces** it (same id, new time). A different commit message, remote, or directory is a new job.

```bash
gtimed push --in 20m
gtimed push --in 5m           # updated <id> — fires in 5m, not 20m
gtimed commit --in 1h -m "a"
gtimed commit --in 10m -m "b" # different -m → second job
```

---

## `tick` vs the queue

`gtimed tick` **runs jobs whose time has already arrived**. It does not run future jobs.

```text
nothing due to run
still waiting:
  31bc95ae  git push  waiting 2026-08-14T10:45:30.827Z
```

- **`nothing due to run`** — nothing is ready **right now**.
- **`still waiting`** — pending jobs and when they will fire (UTC).

`gtimed list` uses the same wording (`waiting …` vs `ran …`) so a pending job never looks like it already ran.

You do not need to run `tick` by hand after `gtimed install`. Task Scheduler does it every minute. `gtimed list` shows the same queue without trying to run anything.

`gtimed run <id>` fires that job now (still checks `--when`).

---

## How commands are parsed

1. Management words (`list`, `cancel`, `tick`, …) are GTimed’s own commands.
2. Anything else is a **job** to schedule.
3. Known git verbs (`commit`, `push`, `fetch`, `add`, `pull`, `status`, …) get `git` prepended.
4. Schedule flags are stripped wherever they appear.
5. `--` means “the rest is the command, stop parsing our flags.”

```bash
gtimed commit -m "x" --in 1h      # → git commit -m x    at now+1h
gtimed git push origin main --in 1h
gtimed --in 1h -- git push origin main
gtimed --in 1h -- gh pr create --fill
```

Use `--` when the wrapped tool also has `--in` / `--at` / `--when`.

---

## Flags

At least one of `--at`, `--in`, `--cron`, `--when`, or `--now` is required.

| Flag | Example | Meaning |
| --- | --- | --- |
| `--in` | `--in 30m` | Run once after a duration |
| `--at` | `--at "tomorrow 5pm"` | Run once at that instant |
| `--cron` | `--cron "0 18 * * 1-5"` | Run on each matching minute (stays `pending`) |
| `--when` | `--when clean` | Repeatable. All must pass at fire time |
| `--until` | `--until "Fri 6pm"` | If conditions never match by then → `failed` |
| `--now` | `--now` | Run on this invocation (still honors `--when`) |
| `--dry-run` | `--dry-run` | Log the command, do not spawn it |
| `--same-branch` | `--same-branch` | Skip if HEAD branch changed since schedule |
| `--cwd` | `--cwd ../other-repo` | Working directory (default: current) |
| `--name` | `--name evening-push` | Label shown in `gtimed list` |
| `--timeout` | `--timeout 2m` | Kill the process after this duration |
| `--retry` | `--retry 3` | Extra attempts after a non-zero exit |
| `--every` | `--every 15s` | Stored on the job; tick cadence is still daemon (15s) or `install` (1 min) |

`--at` uses [chrono-node](https://github.com/wanasit/chrono). Cron uses [cron-parser](https://github.com/harrisiirak/cron-parser) (5-field: `minute hour day-of-month month day-of-week`).

---

## Conditions (`--when`)

Repeatable; **every** spec must pass. Checked in the job’s `cwd` at **fire** time, not when you type the command.

| Spec | Passes when |
| --- | --- |
| `clean` | `git status --porcelain` is empty |
| `dirty` | working tree has changes |
| `staged` | index has staged files |
| `ahead` | local branch has commits not in upstream (`@{u}..HEAD`) — **no fetch** |
| `behind` | upstream has commits you don’t (`HEAD..@{u}`) — **no fetch** |
| `remote-ok` | `git ls-remote origin HEAD` succeeds |
| `branch=main` | current branch name equals `main` |
| `file=src/app.ts` | that path is dirty in `git status` |
| `cmd:<shell>` | shell command exits `0` |

```bash
gtimed --when clean --when ahead -- git push
gtimed --when branch=main --when remote-ok -- git push
gtimed --when "file=package.json" -- git add package.json
gtimed --when "cmd:npm test" -- git push
gtimed --when dirty --until "tomorrow 6pm" -- git add -A
```

`ahead` / `behind` use the **local** tracking ref. They do not `git fetch` on every tick. Combine with `--when remote-ok` or `cmd:git fetch` if you need a fresh remote view.

---

## Job commands

```text
gtimed list                 # also: ls
gtimed cancel <id>          # abort one job (prefix of the id is enough)
gtimed cancel last          # abort the most recently scheduled pending job
gtimed cancel --all         # abort every pending job
gtimed abort                # same as cancel --all
gtimed logs <id>
gtimed --log                # latest job
gtimed --log <id>           # also: gtimed --log last
gtimed run <id>             # fire now; still checks --when and --same-branch
gtimed tick                 # run every due pending job, then exit
gtimed daemon               # tick every 15s in this terminal
gtimed install / uninstall
gtimed completion install
gtimed ui
gtimed help
gtimed version
```

Statuses: `pending` → `running` → `done` | `failed` | `cancelled` | `skipped`.

Cron jobs that succeed go back to `pending`. One-shot jobs become `done`. Failed `--when` before `--until` leave the job `pending` for the next tick.

IDs are 8 hex chars. `gtimed logs abc` and `gtimed --log abc` work if that prefix is unique. `gtimed --log` (no id) prints the latest job. If it has not run, you get the job line plus `has not run yet`. Rescheduling prints `updated <id>` instead of `scheduled <id>`.

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

| Shell | How it is installed |
| --- | --- |
| PowerShell | sourced from your `$PROFILE` |
| bash / Git Bash | `source ~/.gtimed/completion/gtimed.bash` in `~/.bashrc` if that file exists |
| zsh | `~/.zshrc` if that file exists |
| fish | `~/.config/fish/completions/gtimed.fish` |

Open a **new** terminal after install. Print a script without installing: `gtimed completion powershell`. Remove hooks: `gtimed completion uninstall`. Completion is for `gtimed` only (it does not wrap `git`).

---

## Visual Source Control

```bash
gtimed ui
gtimed ui --port 8787 --cwd . --no-open
```

Opens `http://127.0.0.1:8787` (localhost only): file list with stage checkboxes, commit message, Now / In / At / Cron, `--when`, optional push, and the job queue.

### Cursor / VS Code extension

`vscode-extension/` puts clock / upload buttons on the Source Control title bar. See [vscode-extension/README.md](vscode-extension/README.md).

Command Palette: **GTimed: Schedule Commit**, **Schedule Push**, **Open Source Control UI**.

---

## How a tick decides to run

1. Load `pending` jobs.
2. If `--until` is past → `failed`.
3. Time gate: `--at` / `--in` must be due; `--cron` must match the **current minute** (at most once per minute).
4. Evaluate `--when`. If any fail, stay `pending` (unless `--until` already failed).
5. If `--same-branch` and the branch moved → `skipped`.
6. Spawn the command in the saved `cwd` with your current environment (credentials, `ssh-agent`, Git Credential Manager).
7. Non-zero exit: retry if attempts remain, else `failed`.

`--dry-run` writes `would execute …` to the log and counts as success.

Jobs live in `~/.gtimed/jobs.json` (override with `GTIMED_HOME`). Logs: `~/.gtimed/logs/<id>.log`.

---

## Safety

- This is **not** GitHub. A scheduled push uses **your** machine, remotes, and credentials at **fire** time.
- The command is not snapshotted. If you `gtimed push --in 2h` and then commit more, those later commits are included.
- Staged files are not snapshotted either; a delayed `commit` commits whatever is staged **then**.
- `--when` and `--same-branch` exist because the tree can change between schedule and fire.
- `cmd:` runs a shell. Only use commands you trust.
- There is no confirmation prompt. `gtimed push --in 1m` will push when due.

---

## Limitations

- No fire while the OS is asleep; no fire if neither daemon nor `install` / `tick` is running.
- `--remote` / GitHub Actions execution is **not** implemented.
- `--every` is stored but does not change OS tick frequency.
- Not a patch to GitHub.com, upstream git, or VS Code’s built-in Commit button (use `gtimed ui` or the extension beside it).

---

## Development

```bash
npm install
npm run build
npm test
npx tsx src/index.ts --help
```

```text
src/
  index.ts         CLI entry (bin: gtimed)
  parse.ts         Flag stripping, git-verb detection
  time.ts          Durations + natural-language dates
  conditions.ts    --when evaluators
  runner.ts        tick / execute / enqueue
  store.ts         ~/.gtimed JSON store
  install.ts       schtasks / crontab
  completion.ts    tab completion
  repo.ts          git status / stage for the UI
  ui-server.ts     localhost Source Control GUI
ui/                browser SCM panel
vscode-extension/  Cursor / VS Code SCM buttons
```

Related tools: [Git-Schedule](https://github.com/mafex11/Git-Schedule), [GitLater](https://github.com/prakratt/GitLater), [grony](https://github.com/luismedel/grony). Those mostly special-case commit or push. GTimed wraps any command and can wait on repo conditions.

---

## License

[MIT](LICENSE)
