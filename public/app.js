const form = document.getElementById("configForm");
const customForm = document.getElementById("customForm");
const qrBox = document.getElementById("qrBox");
const statusChip = document.getElementById("statusChip");
const schedulerChip = document.getElementById("schedulerChip");
const recipientChip = document.getElementById("recipientChip");
const events = document.getElementById("events");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const sendStartupBtn = document.getElementById("sendStartupBtn");

const workspaceSelect = document.getElementById("workspaceSelect");
const workspaceNameInput = document.getElementById("workspaceNameInput");
const createWorkspaceBtn = document.getElementById("createWorkspaceBtn");
const reportFromInput = document.getElementById("reportFrom");
const reportToInput = document.getElementById("reportTo");
const refreshReportsBtn = document.getElementById("refreshReportsBtn");
const exportCsvLink = document.getElementById("exportCsvLink");
const reportTotal = document.getElementById("reportTotal");
const reportSentOk = document.getElementById("reportSentOk");
const reportSentFailed = document.getElementById("reportSentFailed");
const reportAutoReplies = document.getElementById("reportAutoReplies");
const reportLogs = document.getElementById("reportLogs");
const connectTimer = document.getElementById("connectTimer");
const importForm = document.getElementById("importForm");
const recipientsFileInput = document.getElementById("recipientsFile");
const importResult = document.getElementById("importResult");

let activeWorkspaceId = "";
const lastErrorByWorkspace = new Map();
let connectElapsedSec = 0;
let connectActive = false;

function log(message) {
  const ts = new Date().toLocaleTimeString();
  events.textContent = `[${ts}] ${message}\n${events.textContent}`.slice(0, 9000);
}

function formToObject(formElement) {
  return Object.fromEntries(new FormData(formElement).entries());
}

function applyConfig(config) {
  Object.entries(config).forEach(([key, value]) => {
    const el = form.elements.namedItem(key);
    if (el) {
      el.value = value;
    }
  });
}

async function getJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

function workspacePath(suffix) {
  if (!activeWorkspaceId) {
    throw new Error("No workspace selected.");
  }
  return `/api/workspaces/${activeWorkspaceId}${suffix}`;
}

function reportParams() {
  if (!reportFromInput || !reportToInput) {
    return "";
  }
  const params = new URLSearchParams();
  if (reportFromInput.value) {
    params.set("from", new Date(reportFromInput.value).toISOString());
  }
  if (reportToInput.value) {
    params.set("to", new Date(reportToInput.value).toISOString());
  }
  return params.toString();
}

function setDefaultReportWindow() {
  if (!reportFromInput || !reportToInput) {
    return;
  }
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  reportFromInput.value = from.toISOString().slice(0, 16);
  reportToInput.value = now.toISOString().slice(0, 16);
}

async function refreshReports() {
  if (
    !activeWorkspaceId ||
    !reportTotal ||
    !reportSentOk ||
    !reportSentFailed ||
    !reportAutoReplies ||
    !reportLogs ||
    !exportCsvLink
  ) {
    return;
  }

  try {
    const params = reportParams();
    const suffix = params ? `?${params}` : "";
    const summaryData = await getJson(workspacePath(`/reports/summary${suffix}`));
    const logsData = await getJson(workspacePath(`/reports/logs${suffix}`));

    reportTotal.textContent = summaryData.summary.total;
    reportSentOk.textContent = summaryData.summary.sentOk;
    reportSentFailed.textContent = summaryData.summary.sentFailed;
    reportAutoReplies.textContent = summaryData.summary.autoReplies;

    exportCsvLink.href = workspacePath(`/reports/csv${suffix}`);

    if (!logsData.logs.length) {
      reportLogs.textContent = "No report logs in selected range.";
    } else {
      reportLogs.textContent = logsData.logs
        .slice(0, 80)
        .map((entry) => {
          const status = entry.ok ? "ok" : "fail";
          return `${entry.at} | ${entry.kind} | ${entry.source} | ${status} | ${entry.chatId || entry.from || "-"} | ${entry.message || ""}`;
        })
        .join("\n");
    }
  } catch (err) {
    log(err.message);
  }
}

async function loadWorkspaces() {
  const result = await getJson("/api/workspaces");
  const previous = activeWorkspaceId;

  workspaceSelect.innerHTML = "";
  for (const ws of result.workspaces) {
    const option = document.createElement("option");
    option.value = ws.id;
    option.textContent = `${ws.name} (${ws.id})`;
    workspaceSelect.appendChild(option);
  }

  activeWorkspaceId = result.workspaces.find((ws) => ws.id === previous)?.id || result.workspaces[0]?.id || "";
  workspaceSelect.value = activeWorkspaceId;
}

async function refreshStatus() {
  if (!activeWorkspaceId) {
    return;
  }

  try {
    const status = await getJson(workspacePath("/status"));
    statusChip.textContent = status.status;
    schedulerChip.textContent = `scheduler: ${status.hasScheduler ? "on" : "off"}`;
    recipientChip.textContent = `recipients: ${status.recipientsCount}`;
    connectElapsedSec = status.connectElapsedSec || 0;
    connectActive = !status.ready && ["starting", "qr_ready", "authenticated"].includes(status.status);
    connectTimer.textContent = `Connect timer: ${connectElapsedSec}s`;

    if (status.qrDataUrl) {
      qrBox.innerHTML = `<img alt="WhatsApp QR" src="${status.qrDataUrl}" />`;
    } else {
      qrBox.textContent = status.ready ? "Connected." : "No QR yet";
    }

    if (status.lastError) {
      const prev = lastErrorByWorkspace.get(activeWorkspaceId);
      if (prev !== status.lastError) {
        log(`[${activeWorkspaceId}] error: ${status.lastError}`);
        lastErrorByWorkspace.set(activeWorkspaceId, status.lastError);
      }
    } else {
      lastErrorByWorkspace.delete(activeWorkspaceId);
    }
  } catch (err) {
    log(err.message);
  }
}

setInterval(() => {
  if (!connectActive) {
    return;
  }
  connectElapsedSec += 1;
  connectTimer.textContent = `Connect timer: ${connectElapsedSec}s`;
}, 1000);

async function loadConfig() {
  if (!activeWorkspaceId) {
    return;
  }

  try {
    const config = await getJson(workspacePath("/config"));
    applyConfig(config);
    log(`[${activeWorkspaceId}] config loaded`);
  } catch (err) {
    log(err.message);
  }
}

workspaceSelect.addEventListener("change", async () => {
  activeWorkspaceId = workspaceSelect.value;
  await loadConfig();
  await refreshStatus();
  await refreshReports();
});

createWorkspaceBtn.addEventListener("click", async () => {
  const name = workspaceNameInput.value.trim();
  if (!name) {
    log("workspace name is required");
    return;
  }

  try {
    const result = await getJson("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    workspaceNameInput.value = "";
    await loadWorkspaces();
    activeWorkspaceId = result.workspace.id;
    workspaceSelect.value = activeWorkspaceId;
    await loadConfig();
    await refreshStatus();
    await refreshReports();
    log(`workspace created: ${result.workspace.name} (${result.workspace.id})`);
  } catch (err) {
    log(err.message);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = formToObject(form);
    await getJson(workspacePath("/config"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    log(`[${activeWorkspaceId}] configuration saved`);
    await refreshStatus();
  } catch (err) {
    log(err.message);
  }
});

startBtn.addEventListener("click", async () => {
  try {
    await getJson(workspacePath("/start"), { method: "POST" });
    log(`[${activeWorkspaceId}] starting client`);
    await refreshStatus();
  } catch (err) {
    log(err.message);
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    await getJson(workspacePath("/stop"), { method: "POST" });
    log(`[${activeWorkspaceId}] client stopped`);
    await refreshStatus();
  } catch (err) {
    log(err.message);
  }
});

sendStartupBtn.addEventListener("click", async () => {
  try {
    const result = await getJson(workspacePath("/send-startup"), { method: "POST" });
    log(`[${activeWorkspaceId}] startup message sent to ${result.results.length} recipients`);
    await refreshReports();
  } catch (err) {
    log(err.message);
  }
});

customForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = formToObject(customForm);
    const result = await getJson(workspacePath("/send-custom"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    log(`[${activeWorkspaceId}] custom message sent to ${result.results.length} recipients`);
    customForm.reset();
    await refreshReports();
  } catch (err) {
    log(err.message);
  }
});

if (refreshReportsBtn) {
  refreshReportsBtn.addEventListener("click", async () => {
    await refreshReports();
  });
}

if (importForm && recipientsFileInput && importResult) {
  importForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!recipientsFileInput.files?.length) {
      importResult.textContent = "Select an Excel/CSV file first.";
      return;
    }

    try {
      const formData = new FormData(importForm);
      formData.set("file", recipientsFileInput.files[0]);
      const res = await fetch(workspacePath("/recipients/import"), {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Import failed.");
      }

      importResult.textContent = `Imported ${data.importedCount} numbers. Total recipients: ${data.totalRecipients}.`;
      await loadConfig();
      await refreshStatus();
    } catch (err) {
      importResult.textContent = err.message;
    }
  });
}

(async function init() {
  setDefaultReportWindow();
  await loadWorkspaces();
  await loadConfig();
  await refreshStatus();
  await refreshReports();
  setInterval(refreshStatus, 5000);
})();
