const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function badge(file) {
  if (file.untracked) return { t: "U", c: "untracked" };
  if (file.x === "A" || file.x === "C") return { t: "A", c: "A" };
  if (file.x === "D" || file.y === "D") return { t: "D", c: "D" };
  return { t: "M", c: "M" };
}

async function loadRepo() {
  const repo = await api("/api/repo");
  $("repoMeta").textContent = repo.error
    ? repo.error
    : `${repo.branch || "detached"}  ·  ${repo.root || repo.cwd}`;
  const list = $("files");
  list.innerHTML = "";
  $("noFiles").hidden = repo.files.length > 0;
  for (const file of repo.files) {
    const li = document.createElement("li");
    const b = badge(file);
    li.innerHTML = `<input type="checkbox" ${file.staged ? "checked" : ""} />
      <span class="badge ${b.c}">${b.t}</span>
      <span class="path"></span>`;
    li.querySelector(".path").textContent = file.path;
    li.querySelector("input").addEventListener("change", async (ev) => {
      try {
        await api("/api/stage", {
          method: "POST",
          body: JSON.stringify({ paths: [file.path], staged: ev.target.checked }),
        });
        await loadRepo();
      } catch (err) {
        flash(err.message, true);
      }
    });
    list.appendChild(li);
  }
}

function jobWhen(job) {
  if (job.status === "pending") {
    if (job.cron) return `waiting cron ${job.cron}`;
    if (job.at) return `waiting ${job.at.replace("T", " ").slice(0, 19)}`;
    if (job.when?.length) return `waiting when ${job.when.join(", ")}`;
    return "waiting";
  }
  if (job.lastRunAt) return `${job.status} ${job.lastRunAt.replace("T", " ").slice(0, 19)}`;
  return job.status;
}

async function loadJobs() {
  const { jobs } = await api("/api/jobs");
  const body = $("jobs");
  body.innerHTML = "";
  if (!jobs.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty">No jobs yet.</td></tr>`;
    return;
  }
  for (const job of jobs.slice().reverse()) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td></td><td></td><td class="cmd"></td><td></td>`;
    tr.cells[0].textContent = job.id;
    tr.cells[1].textContent = job.status;
    tr.cells[2].textContent = jobWhen(job);
    tr.cells[3].textContent = (job.command || []).join(" ");
    if (job.status === "pending") {
      const cancel = document.createElement("button");
      cancel.className = "tiny";
      cancel.textContent = "Cancel";
      cancel.onclick = async () => {
        await api(`/api/jobs/${job.id}/cancel`, { method: "POST", body: "{}" });
        await loadJobs();
      };
      const run = document.createElement("button");
      run.className = "tiny";
      run.textContent = "Run";
      run.onclick = async () => {
        await api(`/api/jobs/${job.id}/run`, { method: "POST", body: "{}" });
        await loadJobs();
        await loadRepo();
      };
      tr.cells[4].append(run, cancel);
    }
    body.appendChild(tr);
  }
}

function flash(text, err = false) {
  const el = $("status");
  el.textContent = text;
  el.className = "status " + (err ? "err" : "ok");
}

function mode() {
  return document.querySelector('input[name="mode"]:checked')?.value || "in";
}

$("go").onclick = async () => {
  const message = $("message").value.trim();
  if (!message) {
    flash("Commit message is required.", true);
    return;
  }
  const cond = $("whenCond").value;
  try {
    const result = await api("/api/schedule", {
      method: "POST",
      body: JSON.stringify({
        message,
        mode: mode(),
        in: $("inVal").value.trim(),
        at: $("atVal").value,
        cron: $("cronVal").value.trim(),
        when: cond ? [cond] : [],
        push: $("push").checked,
        sameBranch: $("sameBranch").checked,
        dryRun: $("dryRun").checked,
      }),
    });
    const extra = result.push ? ` + push ${result.push.id}` : "";
    flash(`Scheduled ${result.commit.id}${extra}`, false);
    $("message").value = "";
    await loadJobs();
    await loadRepo();
  } catch (err) {
    flash(err.message, true);
  }
};

$("refresh").onclick = () => Promise.all([loadRepo(), loadJobs()]);
loadRepo().catch((err) => flash(err.message, true));
loadJobs().catch((err) => flash(err.message, true));
