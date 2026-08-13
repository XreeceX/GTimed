# GTimed

**Schedule git (and any other CLI) for later, on a cron, or when a condition matches.**

GitHub and `git.exe` have no `--in` / `--at`. After install, GTimed puts a **git shim** first on PATH so those flags work on the commands you already type:

```bash
git commit -m "Hello world" --in 20m
git push --at "tomorrow 9am"
git fetch --cron "0 */4 * * *"
git push --when clean
```

Without those flags, `git` is unchanged (`git status` still hits real git). `gtimed …` still wraps any CLI (`gh`, scripts, …).

---

## Why this exists

| Layer | Can it delay `git push`? |
| --- | --- |
| GitHub.com | No. Actions cron runs **CI on GitHub**, not your working tree. |
| `git` | No. Extra flags error out. |
| OS `at` / cron / Task Scheduler | Yes, but you retype the full command and cwd every time. |
| GTimed | Yes: git shim (`git commit --in 20m`), job list, logs, conditions. |

Related tools on GitHub ([Git-Schedule](https://github.com/mafex11/Git-Schedule), [GitLater](https://github.com/prakratt/GitLater), [grony](https://github.com/luismedel/grony)) mostly special-case **commit** or **push**. GTimed wraps **any** command and can wait on repo conditions.

---

## Requirements

- Node.js 18+
- `git` on PATH (for git verbs and `--when` checks)
- Windows, macOS, or Linux

Jobs only run if something calls `gtimed tick` (a daemon, or an OS minute timer). The machine must be **awake**. Sleeping laptops do not fire jobs until the next tick after wake.

---

## Install

```bash
cd GTimed
npm install
npm run build
npm link
gtimed install
```

(`npm install` also runs `prepare` → `tsc`, so `npm run build` is optional after a clean install.)

`gtimed install` does two things:

1. Writes a **git shim** to `~/.gtimed/shim` and puts that directory first on your **user PATH** (new terminals pick it up).
2. Registers a **minute tick** (Windows Task Scheduler / crontab) so due jobs actually run.

Then in a **new** terminal:

```bash
git commit -m "Hello world" --in 20m
```

That puts two extra commands on PATH as well:

| Command | Role |
| --- | --- |
| `gtimed` | Scheduler CLI (list, cancel, tick, wrap `gh`, …) |
| `git-timed` | Git subcommand → `git timed …` |

Uninstall: `gtimed uninstall` (removes shim PATH entry, shim files, and the OS timer). Unlink the npm bin with `npm unlink -g gtimed`.

Until you open a new terminal, you can prepend PATH for the current session:

```powershell
$env:Path = "$env:USERPROFILE\.gtimed\shim;" + $env:Path
```

```bash
export PATH="$HOME/.gtimed/shim:$PATH"
```

---

## Quick start

```bash
# after gtimed install — flags on real git
git commit -m "Hello world" --in 20m
git push --at "tomorrow 9am"
git fetch --cron "0 */4 * * *"
git push --when clean

# same flags via gtimed (any CLI)
gtimed push --in 20m
gtimed commit --at "tomorrow 9am" -m "release notes"
gtimed fetch --at "2026-08-14T09:00"
gtimed fetch --all --cron "0 */4 * * *"
gtimed --when clean -- git push
gtimed --at "Fri 17:00" --when ahead --same-branch -- git push origin main
gtimed --in 30m -- gh pr create --fill
gtimed status --now --dry-run
```

Then:

```bash
gtimed list
gtimed logs <id>
gtimed cancel <id>
```

---

## How commands are parsed

1. **Management words** (`list`, `cancel`, `tick`, …) are GTimed’s own commands.
2. Anything else is a **job** to schedule.
3. Known **git verbs** (`commit`, `push`, `fetch`, `add`, `pull`, `status`, …) get `git` prepended.
4. Schedule flags (`--at`, `--in`, `--when`, …) are stripped wherever they appear.
5. `--` means “the rest is the command, stop parsing our flags.”

```bash
gtimed commit -m "x" --in 1h     # → git commit -m x    at now+1h
gtimed git push origin main --in 1h
gtimed --in 1h -- git push origin main
gtimed --in 1h -- gh pr create --fill
```

`--` is the safe form when the wrapped tool also uses `--at` / `--in` / `--when`.

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

Durations: `30s`, `5m`, `2h`, `1d`, `1w` (also `min`, `hours`, `days`, …). `--at` also accepts ISO (`2026-08-14T09:00`) and phrases via [chrono-node](https://github.com/wanasit/chrono) (`tomorrow 9am`, `Friday 17:00`).

Cron uses [cron-parser](https://github.com/harrisiirak/cron-parser) (5-field crontab is fine: `minute hour day-of-month month day-of-week`).

---

## Conditions (`--when`)

Repeatable; **every** spec must pass. Checked in the job’s `cwd` at tick time, not at schedule time.

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

Examples:

```bash
gtimed --when clean --when ahead -- git push
gtimed --when branch=main --when remote-ok -- git push
gtimed --when "file=package.json" -- git add package.json
gtimed --when "cmd:npm test" -- git push
gtimed --when dirty --until "tomorrow 6pm" -- git add -A
```

`ahead` / `behind` use the **local** tracking ref. They do not `git fetch` on every tick (that would be noisy). Combine with `--when remote-ok` or `cmd:git fetch` if you need a fresh remote view.

---

## Job commands

```text
gtimed list                 # also: ls
gtimed cancel <id>          # prefix of the 8-char id is enough if unique
gtimed logs <id>
gtimed run <id>             # fire now; still checks --when and --same-branch
gtimed tick                 # run every due pending job, then exit
gtimed daemon
gtimed install / uninstall
gtimed completion install     # tab completion (also part of gtimed install)
gtimed shim install | uninstall | status
gtimed help
gtimed version
```

Statuses: `pending` → `running` → `done` | `failed` | `cancelled` | `skipped`.

Cron jobs that succeed go back to `pending`. One-shot jobs become `done`. Failed conditions before `--until` leave the job `pending` for the next tick.

IDs are short (8 hex chars). `gtimed logs abc` works if that prefix is unique.

---

## Tab completion

`gtimed install` (or `gtimed completion install`) hooks your shell so Tab fills in commands, flags, `--when` values, durations, and job ids.

```bash
gtimed ca<Tab>              # cancel
gtimed --i<Tab>             # --in
gtimed commit --w<Tab>      # --when
gtimed --when c<Tab>        # clean / cmd:
gtimed cancel <Tab>         # job ids
git commit --i<Tab>         # --in  (bash / zsh / Git Bash)
```

| Shell | How it is installed |
| --- | --- |
| PowerShell | sourced from your `$PROFILE` |
| bash / Git Bash | `source ~/.gtimed/completion/gtimed.bash` in `~/.bashrc` if that file exists |
| zsh | `~/.zshrc` if that file exists |
| fish | `~/.config/fish/completions/gtimed.fish` |

Open a **new** terminal after install. Print a script without installing: `gtimed completion powershell`. Remove hooks: `gtimed completion uninstall`.

On PowerShell, completion is for `gtimed` / `git-timed` only, so it does not replace posh-git. In bash/zsh the git wrapper **adds** `--in` / `--at` / `--when` next to git’s own completions.

---

## Visual Source Control (IDE-style GUI)

Cursor, VS Code, and GitHub Desktop own their Git panels. We cannot inject `--in` into those apps’ built-in Commit button. GTimed adds **its own** UI that uses the same scheduler:

```bash
gtimed ui
```

Opens `http://127.0.0.1:8787` (localhost only): file list with stage checkboxes, commit message, Now / In / At / Cron, `--when`, optional push, and the job queue.

```bash
gtimed ui --port 8787 --cwd . --no-open
```

### Cursor / VS Code extension

`vscode-extension/` puts clock / upload buttons on the **Source Control** title bar (next to Git’s own Commit). It reads the SCM commit box, asks when to run, then calls GTimed.

See [vscode-extension/README.md](vscode-extension/README.md) to install from this folder (junction into `~/.cursor/extensions` or **Developer: Install Extension from Location…**).

Command Palette: **GTimed: Schedule Commit**, **Schedule Push**, **Open Source Control UI**.

---

## Git flags (`--in`, `--at`, `--when`, …)

GTimed cannot patch `git.exe`. `gtimed install` writes a **PATH wrapper** (`~/.gtimed/shim`) and puts it first on your user PATH.

- If argv contains `--in`, `--at`, `--cron`, `--when`, `--until`, `--dry-run`, `--now`, `--same-branch`, … → schedule the rest as a job.
- Otherwise → real git (path stored in `~/.gtimed/real-git`).

```bash
git commit -m "Hello world" --in 20m
git push --at "tomorrow 9am"
git status                    # unchanged
```

Calling `git.exe` by full path bypasses the shim. Override the real binary with `GTIMED_REAL_GIT`.

Shim-only (no Task Scheduler / crontab): `gtimed shim install`. Remove: `gtimed uninstall` or `gtimed shim uninstall`.

---

## Storage

Default home: `~/.gtimed` (override with `GTIMED_HOME`).

```text
~/.gtimed/
  jobs.json          # queue
  real-git           # absolute path to real git.exe
  logs/<id>.log      # stdout/stderr + GTimed lines
  shim/git.cmd       # Windows cmd/PowerShell
  shim/git.ps1
  shim/git           # Git Bash / macOS / Linux
```

Each job records `command`, `cwd`, git root and branch at schedule time, schedule fields, and status.

---

## How a tick decides to run

1. Load `pending` jobs.
2. If `--until` is past → `failed`.
3. Time gate: `--at`/`--in` must be due; `--cron` must match the **current minute** (at most once per minute).
4. Evaluate `--when`. If any fail, stay `pending` (unless `--until` already failed).
5. If `--same-branch` and the branch moved → `skipped`.
6. Spawn the command in the saved `cwd` with your current environment (credentials, `ssh-agent`, Git Credential Manager, etc.).
7. Non-zero exit: retry if attempts remain, else `failed`.

`--dry-run` writes `would execute …` to the log and counts as success.

---

## Safety

- This is **not** GitHub. A scheduled push uses **your** machine, **your** remotes, **your** credentials, at **fire** time.
- The command is not snapshotted as a commit object. If you `gtimed push --in 2h` and then commit more, those later commits are included.
- `--when` and `--same-branch` exist because the tree can change between schedule and fire.
- `cmd:` runs a shell. Only use commands you trust.
- There is no confirmation prompt. `gtimed push --in 1m` will push when due.

---

## Environment

| Variable | Purpose |
| --- | --- |
| `GTIMED_HOME` | Alternate data directory (useful in tests) |
| `GTIMED_REAL_GIT` | Absolute path to real `git` for the shim |

---

## Development

```bash
npm install
npm run build
npm test
npx tsx src/index.ts --help
```

Layout:

```text
src/
  index.ts         CLI entry (bin: gtimed / git-timed)
  parse.ts         Flag stripping, git-verb detection
  time.ts          Durations + natural-language dates
  conditions.ts    --when evaluators
  runner.ts        tick / execute / job builder
  store.ts         ~/.gtimed JSON store
  install.ts       schtasks / crontab
  shim.ts          git PATH wrapper
  completion.ts    tab completion engine + shell scripts
  repo.ts          git status / stage for the UI
  ui-server.ts     localhost Source Control GUI
  parse.test.ts
  completion.test.ts
ui/                browser SCM panel
vscode-extension/  Cursor / VS Code SCM buttons
```

---

## Limitations (honest)

- No fire while the OS is asleep; no fire if neither daemon nor `install`/`tick` is running.
- `--remote` / GitHub Actions execution is **not** implemented (Git-Schedule has that pattern).
- Staged files are **not** snapshotted; a delayed `commit` commits whatever is staged **then**.
- `--every` is stored but does not change OS tick frequency.
- Not a patch to GitHub.com, upstream git, or VS Code’s built-in Commit button (use `gtimed ui` or the extension beside it).

---

## License

[MIT](LICENSE)
