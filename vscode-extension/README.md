# Cursor / VS Code extension

Adds **clock** and **upload** buttons to the Git Source Control title bar (the same strip as Commit), plus Command Palette entries.

## What you get

| Command | Where |
| --- | --- |
| **GTimed: Schedule Commit** | SCM title bar + Command Palette |
| **GTimed: Schedule Push** | SCM title bar + Command Palette |
| **GTimed: Open Source Control UI** | Command Palette — opens `gtimed ui` in the browser |

Schedule Commit uses the message already typed in the SCM input box (or asks if it is empty), then a Quick Pick: in 5m / 20m / 1h / 2h, tomorrow 9am, when clean, or a custom `--in` / `--at` / `--when`.

It calls the same CLI as the rest of the project (`dist/index.js` in the parent folder).

## Install into Cursor or VS Code (local)

1. Build GTimed: `npm run build` in the repo root.
2. Copy or symlink this folder into your extensions dir, **or** from the Command Palette run **Developer: Install Extension from Location…** and pick `vscode-extension`.
3. Reload the window.

Typical extensions folders:

- Cursor: `%USERPROFILE%\.cursor\extensions\gtimed`
- VS Code: `%USERPROFILE%\.vscode\extensions\gtimed`

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.cursor\extensions\gtimed" -Target "C:\Users\reece\Desktop\project\GTimed\vscode-extension"
```

Then reload Cursor. A clock icon should appear on the Source Control view when a git repo is open.

The built-in Git Commit button is unchanged. GTimed sits next to it.
