const vscode = require("vscode");
const path = require("path");
const { spawn } = require("child_process");

const DELAYS = [
  { label: "In 5 minutes", args: ["--in", "5m"] },
  { label: "In 20 minutes", args: ["--in", "20m"] },
  { label: "In 1 hour", args: ["--in", "1h"] },
  { label: "In 2 hours", args: ["--in", "2h"] },
  { label: "Tomorrow 9:00", args: ["--at", "tomorrow 9am"] },
  { label: "When working tree is clean", args: ["--when", "clean"] },
  { label: "Custom…", args: null },
];

function gtimedEntry(context) {
  return path.join(context.extensionPath, "..", "dist", "index.js");
}

function workspaceCwd() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
}

function gitApi() {
  const ext = vscode.extensions.getExtension("vscode.git");
  return ext?.isActive ? ext.exports.getAPI(1) : undefined;
}

function commitMessage() {
  const api = gitApi();
  const repo = api?.repositories?.[0];
  return repo?.inputBox?.value?.trim() || "";
}

function runGtimed(context, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [gtimedEntry(context), ...args], {
      cwd: workspaceCwd(),
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || out.trim() || `gtimed exited ${code}`));
    });
  });
}

async function pickSchedule() {
  const pick = await vscode.window.showQuickPick(
    DELAYS.map((d) => ({ label: d.label, args: d.args })),
    { placeHolder: "When should git run?" },
  );
  if (!pick) return undefined;
  if (pick.args) return pick.args;
  const custom = await vscode.window.showInputBox({
    prompt: 'Custom schedule, e.g. --in 45m   or   --at "Fri 17:00"   or   --when ahead',
    value: "--in 20m",
  });
  if (!custom) return undefined;
  return custom.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((s) => s.replace(/^"|"$/g, "")) ?? [];
}

async function scheduleCommit(context) {
  let message = commitMessage();
  if (!message) {
    message = await vscode.window.showInputBox({ prompt: "Commit message" });
  }
  if (!message) return;
  const sched = await pickSchedule();
  if (!sched) return;
  const out = await runGtimed(context, ["commit", "-m", message, ...sched]);
  vscode.window.showInformationMessage(out.split("\n")[0] || "Scheduled commit");
}

async function schedulePush(context) {
  const sched = await pickSchedule();
  if (!sched) return;
  const out = await runGtimed(context, ["push", ...sched]);
  vscode.window.showInformationMessage(out.split("\n")[0] || "Scheduled push");
}

async function openUi(context) {
  const port = "8787";
  spawn(process.execPath, [gtimedEntry(context), "ui", "--port", port, "--cwd", workspaceCwd()], {
    cwd: workspaceCwd(),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
  vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${port}`));
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("gtimed.scheduleCommit", () => scheduleCommit(context)),
    vscode.commands.registerCommand("gtimed.schedulePush", () => schedulePush(context)),
    vscode.commands.registerCommand("gtimed.openUi", () => openUi(context)),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
