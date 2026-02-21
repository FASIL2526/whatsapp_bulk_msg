const form = document.getElementById("configForm");
const customForm = document.getElementById("customForm");
const qrBox = document.getElementById("qrBox");
const statusChip = document.getElementById("statusChip");
const statusDot = document.getElementById("statusDot");
const schedulerChip = document.getElementById("schedulerChip");
const recipientChip = document.getElementById("recipientChip");
const events = document.getElementById("events");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

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
const connectTimer = document.getElementById("connectTimer");
const recipientsFileInput = document.getElementById("recipientsFile");
const importBtn = document.getElementById("importBtn");
const importResult = document.getElementById("importResult");
const authShell = document.getElementById("authShell");
const authForm = document.getElementById("authForm");
const authMessage = document.getElementById("authMessage");
const registerBtn = document.getElementById("registerBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userPill = document.getElementById("userPill");

const instantMessage1 = document.getElementById("instantMessage1");
const instantMessage2 = document.getElementById("instantMessage2");
const multiMessagePreview = document.getElementById("multiMessagePreview");
const bulkProgress = document.getElementById("bulkProgress");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");

let activeWorkspaceId = "";
const lastErrorByWorkspace = new Map();
let connectElapsedSec = 0;
let connectActive = false;
let workspaceReady = false;
let workspaceAuthenticated = false;
let authToken = localStorage.getItem("rx_auth_token") || "";
let currentUser = null;

// --- Theme Logic ---
function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("rx_theme", theme);
  if (themeToggle) themeToggle.checked = theme === "dark";
}

if (themeToggle) {
  themeToggle.addEventListener("change", () => {
    setTheme(themeToggle.checked ? "dark" : "light");
  });
}

const savedTheme = localStorage.getItem("rx_theme") || "light";
setTheme(savedTheme);

// --- Message Preview Logic ---
function updatePreview(text) {
  if (!messagePreview) return;
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length === 0) {
    messagePreview.innerHTML = '<div class="msg-bubble sent">Your message will appear here...</div>';
    return;
  }
  // Show first line as preview
  messagePreview.innerHTML = `<div class="msg-bubble sent">${lines[0].replace(/\n/g, "<br>")}</div>`;
  if (lines.length > 1) {
    messagePreview.innerHTML += `<div class="muted" style="font-size: 11px; margin-top: 4px;">+ ${lines.length - 1} more templates in rotation</div>`;
  }
}

// --- Multi-Message Preview Logic ---
function updateMultiPreview() {
  if (!multiMessagePreview) return;
  const m1 = instantMessage1?.value.trim() || "";
  const m2 = instantMessage2?.value.trim() || "";

  if (!m1 && !m2) {
    multiMessagePreview.innerHTML = '<div class="msg-bubble received">Preview will appear as you type...</div>';
    return;
  }

  let html = "";
  if (m1) html += `<div class="msg-bubble sent" style="margin-bottom: 12px; border-bottom-left-radius: 0; align-self: flex-start; background: #fff; color: #333; border: 1px solid #ddd;"><b>Msg 1:</b><br>${m1.replace(/\n/g, "<br>")}</div>`;
  if (m2) html += `<div class="msg-bubble sent" style="margin-top: 4px; align-self: flex-start; background: #dcf8c6; color: #000; border: 1px solid #c9ebae;"><b>Msg 2:</b><br>${m2.replace(/\n/g, "<br>")}</div>`;

  multiMessagePreview.innerHTML = html;
  multiMessagePreview.scrollTop = multiMessagePreview.scrollHeight;
}

[instantMessage1, instantMessage2].forEach(el => {
  el?.addEventListener("input", updateMultiPreview);
});

if (templateInput) {
  templateInput.addEventListener("input", (e) => updatePreview(e.target.value));
}

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
      if (key === "BULK_TEMPLATE_LINES") updatePreview(value);
    }
  });
}

async function getJson(url, options) {
  const opts = { ...(options || {}) };
  opts.headers = { ...(opts.headers || {}) };
  if (authToken) {
    opts.headers.Authorization = `Bearer ${authToken}`;
  }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (res.status === 401) {
    clearAuth();
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

function setAuth(token, user) {
  authToken = token;
  currentUser = user;
  localStorage.setItem("rx_auth_token", token);
  authShell.style.display = "none";
  document.querySelector("main.layout").style.display = "grid";
  userPill.textContent = user.username;
}

function clearAuth() {
  authToken = "";
  currentUser = null;
  localStorage.removeItem("rx_auth_token");
  authShell.style.display = "flex";
  document.querySelector("main.layout").style.display = "none";
  userPill.textContent = "-";
}

async function checkAuth() {
  if (!authToken) {
    clearAuth();
    return false;
  }
  try {
    const me = await getJson("/api/auth/me");
    setAuth(authToken, me.user);
    return true;
  } catch (_err) {
    clearAuth();
    return false;
  }
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
  if (!activeWorkspaceId || !reportTotal) return;

  try {
    const params = reportParams();
    const suffix = params ? `?${params}` : "";
    const summaryData = await getJson(workspacePath(`/reports/summary${suffix}`));

    reportTotal.textContent = summaryData.summary.total;
    reportSentOk.textContent = summaryData.summary.sentOk;
    reportSentFailed.textContent = summaryData.summary.sentFailed;
    reportAutoReplies.textContent = summaryData.summary.autoReplies;

    exportCsvLink.href = workspacePath(`/reports/csv${suffix}`);
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
    option.textContent = ws.name;
    workspaceSelect.appendChild(option);
  }

  activeWorkspaceId = result.workspaces.find((ws) => ws.id === previous)?.id || result.workspaces[0]?.id || "";
  if (activeWorkspaceId) {
    workspaceSelect.value = activeWorkspaceId;
  }
}

async function refreshStatus() {
  if (!activeWorkspaceId) return;

  try {
    const status = await getJson(workspacePath("/status"));
    statusChip.textContent = status.status;
    if (statusDot) {
      statusDot.className = "status-dot " + (status.ready ? "active" : "");
    }
    schedulerChip.textContent = `scheduler: ${status.hasScheduler ? "on" : "off"}`;
    recipientChip.textContent = `recipients: ${status.recipientsCount}`;
    workspaceReady = Boolean(status.ready);
    workspaceAuthenticated = Boolean(status.authenticated);
    connectElapsedSec = status.connectElapsedSec || 0;
    connectActive = !status.ready && ["starting", "qr_ready", "authenticated"].includes(status.status);
    connectTimer.textContent = `Connect timer: ${connectElapsedSec}s`;

    if (status.qrDataUrl) {
      qrBox.innerHTML = `<img alt="WhatsApp QR" src="${status.qrDataUrl}" />`;
    } else {
      qrBox.innerHTML = `<div class="muted">${status.ready ? "Connected and Ready" : "No QR yet"}</div>`;
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
  if (!connectActive) return;
  connectElapsedSec += 1;
  connectTimer.textContent = `Connect timer: ${connectElapsedSec}s`;
}, 1000);

async function loadConfig() {
  if (!activeWorkspaceId) return;
  try {
    const config = await getJson(workspacePath("/config"));
    applyConfig(config);
    log(`[${activeWorkspaceId}] configuration loaded`);
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
  if (!name) return;

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
    log(`workspace created: ${result.workspace.name}`);
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
    log(`[${activeWorkspaceId}] starting client...`);
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

function updateProgressBar(current, total) {
  if (!bulkProgress || !progressBar || !progressText) return;
  bulkProgress.style.display = "block";
  const percent = total > 0 ? (current / total) * 100 : 0;
  progressBar.style.width = percent + "%";
  progressText.textContent = `${current}/${total}`;
  if (current === total && total > 0) {
    setTimeout(() => {
      bulkProgress.style.display = "none";
      progressBar.style.width = "0%";
    }, 3000);
  }
}

customForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!(workspaceReady || workspaceAuthenticated)) {
    log(`[${activeWorkspaceId}] WhatsApp client is not connected yet.`);
    return;
  }
  try {
    const m1 = instantMessage1.value.trim();
    const m2 = instantMessage2.value.trim();
    const messages = [m1, m2].filter(Boolean);

    if (messages.length === 0) {
      log("Please enter at least one message.");
      return;
    }

    log(`[${activeWorkspaceId}] launching sequential campaign...`);
    const result = await getJson(workspacePath("/send-custom"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    // Simulate progress bar based on results
    const total = result.results.length;
    let current = 0;
    const interval = setInterval(() => {
      current += 1;
      updateProgressBar(current, total);
      if (current >= total) clearInterval(interval);
    }, 100);

    const recipientCount = total / messages.length;
    log(`[${activeWorkspaceId}] campaign finished. Sent ${messages.length} messages to ${recipientCount} recipients.`);
    customForm.reset();
    updateMultiPreview();
    await refreshReports();
  } catch (err) {
    log(err.message);
  }
});

if (refreshReportsBtn) {
  refreshReportsBtn.addEventListener("click", refreshReports);
}

if (importBtn && recipientsFileInput && importResult) {
  importBtn.addEventListener("click", async () => {
    if (!recipientsFileInput.files?.length) {
      importResult.textContent = "Select an Excel/CSV file first.";
      return;
    }

    try {
      const formData = new FormData();
      formData.set("file", recipientsFileInput.files[0]);
      formData.set("mode", "append");
      const res = await fetch(workspacePath("/recipients/import"), {
        method: "POST",
        headers: { "Authorization": `Bearer ${authToken}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || "Import failed.");

      importResult.textContent = `Imported ${data.importedCount} numbers. Total: ${data.totalRecipients}.`;
      await loadConfig();
    } catch (err) {
      importResult.textContent = err.message;
    }
  });
}

if (authForm) {
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formToObject(authForm);
    try {
      const result = await getJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setAuth(result.token, result.user);
      await loadWorkspaces();
      await loadConfig();
      await refreshStatus();
      await refreshReports();
    } catch (err) {
      authMessage.textContent = err.message;
    }
  });
}

if (registerBtn) {
  registerBtn.addEventListener("click", async () => {
    const payload = formToObject(authForm);
    try {
      const result = await getJson("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setAuth(result.token, result.user);
      await loadWorkspaces();
      await loadConfig();
      await refreshStatus();
      await refreshReports();
    } catch (err) {
      authMessage.textContent = err.message;
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", clearAuth);
}

(async function init() {
  setDefaultReportWindow();
  const ok = await checkAuth();
  if (ok) {
    await loadWorkspaces();
    await loadConfig();
    await refreshStatus();
    await refreshReports();
  }
  setInterval(refreshStatus, 5000);
})();
