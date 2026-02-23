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
const themeToggle = document.getElementById("themeToggle");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarOverlay = document.getElementById("sidebarOverlay");

const leadsTableBody = document.getElementById("leadsTableBody");
const leadsEmptyState = document.getElementById("leadsEmptyState");
const refreshLeadsBtn = document.getElementById("refreshLeadsBtn");

const overviewTotal = document.getElementById("overviewTotal");
const overviewRate = document.getElementById("overviewRate");
const sidebar = document.getElementById("sidebar");
const navItems = document.querySelectorAll(".nav-item");
const viewContainers = document.querySelectorAll(".view-container");
const customSubmitBtn = customForm?.querySelector('button[type="submit"]');
const templateInput = document.getElementById("templateInput");
const messagePreview = document.getElementById("messagePreview");
const instantMessage1 = document.getElementById("instantMessage1");
const instantMessage2 = document.getElementById("instantMessage2");
const multiMessagePreview = document.getElementById("multiMessagePreview");
const bulkProgress = document.getElementById("bulkProgress");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const assistBusinessName = document.getElementById("assistBusinessName");
const assistOffer = document.getElementById("assistOffer");
const assistAudience = document.getElementById("assistAudience");
const assistGoal = document.getElementById("assistGoal");
const assistTone = document.getElementById("assistTone");
const generateAiAssistBtn = document.getElementById("generateAiAssistBtn");
const aiAssistResult = document.getElementById("aiAssistResult");
const postStatusNowBtn = document.getElementById("postStatusNowBtn");
const statusPostResult = document.getElementById("statusPostResult");

// --- Mobile Sidebar Logic ---
function openSidebar() {
  sidebar.classList.add("open");
  sidebarOverlay.classList.add("visible");
  document.body.style.overflow = "hidden";
}

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("visible");
  document.body.style.overflow = "";
}

if (sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
  });
}

if (sidebarOverlay) {
  sidebarOverlay.addEventListener("click", closeSidebar);
}

let activeWorkspaceId = "";
const lastErrorByWorkspace = new Map();
let connectElapsedSec = 0;
let connectActive = false;
let workspaceReady = false;
let workspaceAuthenticated = false;
let workspaceSendInProgress = false;
let statusRefreshInFlight = false;
let customSendInFlight = false;
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

function showToast(message, variant = "info") {
  const toast = document.createElement("div");
  const bg = variant === "error" ? "#dc2626" : variant === "success" ? "#059669" : "#334155";
  toast.textContent = message;
  toast.style.position = "fixed";
  toast.style.right = "20px";
  toast.style.bottom = "20px";
  toast.style.zIndex = "9999";
  toast.style.maxWidth = "360px";
  toast.style.padding = "12px 14px";
  toast.style.borderRadius = "10px";
  toast.style.color = "#fff";
  toast.style.background = bg;
  toast.style.boxShadow = "0 10px 30px rgba(0,0,0,0.25)";
  toast.style.fontSize = "13px";
  toast.style.opacity = "0";
  toast.style.transform = "translateY(8px)";
  toast.style.transition = "all 160ms ease";
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 180);
  }, 3200);
}

function notifyDesktop(title, body) {
  if (!("Notification" in window)) {
    return;
  }
  if (Notification.permission === "granted") {
    // Fire-and-forget user notification for campaign completion.
    new Notification(title, { body });
    return;
  }
  if (Notification.permission === "default") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        new Notification(title, { body });
      }
    }).catch(() => { });
  }
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
  sidebar.style.display = "flex";
  document.querySelector("main.layout").style.display = "flex";
  userPill.textContent = user.username;
  syncCampaignButtonState();
  // Re-init icons since sidebar and main content are now visible
  requestAnimationFrame(() => {
    if (window.lucide) window.lucide.createIcons();
  });
}

function clearAuth() {
  authToken = "";
  currentUser = null;
  localStorage.removeItem("rx_auth_token");
  authShell.style.display = "flex";
  sidebar.style.display = "none";
  document.querySelector("main.layout").style.display = "none";
  userPill.textContent = "-";
  syncCampaignButtonState();
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

function syncCampaignButtonState() {
  if (!customSubmitBtn) return;
  const disabled = customSendInFlight || workspaceSendInProgress || !(workspaceReady || workspaceAuthenticated);
  customSubmitBtn.disabled = disabled;
  if (customSendInFlight || workspaceSendInProgress) {
    customSubmitBtn.textContent = "Campaign Running...";
    return;
  }
  if (!(workspaceReady || workspaceAuthenticated)) {
    customSubmitBtn.textContent = "Client Not Ready";
    return;
  }
  customSubmitBtn.textContent = "🚀 Launch Dual-Message Campaign";
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

    const setStats = (total, ok, failed, auto) => {
      if (reportTotal) reportTotal.textContent = total;
      if (reportSentOk) reportSentOk.textContent = ok;
      if (reportSentFailed) reportSentFailed.textContent = failed;
      if (reportAutoReplies) reportAutoReplies.textContent = auto;

      if (overviewTotal) overviewTotal.textContent = total;
      if (overviewRate) {
        const rate = total > 0 ? Math.round((ok / total) * 100) : 0;
        overviewRate.textContent = `${rate}%`;
      }
    };

    setStats(
      summaryData.summary.total,
      summaryData.summary.sentOk,
      summaryData.summary.sentFailed,
      summaryData.summary.autoReplies
    );

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
  if (statusRefreshInFlight) return;
  statusRefreshInFlight = true;

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
    workspaceSendInProgress = Boolean(status.sendInProgress);
    connectElapsedSec = status.connectElapsedSec || 0;
    connectActive = !status.ready && ["starting", "qr_ready", "authenticated"].includes(status.status);
    connectTimer.textContent = `Connect timer: ${connectElapsedSec}s`;
    syncCampaignButtonState();

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
  } finally {
    statusRefreshInFlight = false;
  }
}

setInterval(() => {
  if (!connectActive) return;
  connectElapsedSec += 1;
  connectTimer.textContent = `Connect timer: ${connectElapsedSec}s`;
}, 1000);

async function loadLeads() {
  if (!activeWorkspaceId) return;
  try {
    // This function body is a placeholder, assuming it will be filled later.
    // For now, it's empty to avoid duplicating loadConfig's logic.
  } catch (err) {
    log(err.message);
  }
}

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

    // API Validation for AI Sales Closer
    if (payload.AI_SALES_ENABLED === "true" && payload.AI_API_KEY) {
      const provider = payload.AI_PROVIDER || "google";
      log(`[${activeWorkspaceId}] Validating AI Key for ${provider} (${payload.AI_MODEL})...`);
      try {
        const validation = await getJson(workspacePath("/validate-ai-key"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: payload.AI_API_KEY,
            model: payload.AI_MODEL,
            provider: provider
          }),
        });
        if (!validation.ok) throw new Error(validation.error);
        log(`[${activeWorkspaceId}] AI API Key validated successfully.`);
      } catch (err) {
        log(`[${activeWorkspaceId}] AI API Key validation failed: ${err.message}`);
        showToast(`AI Key Error: ${err.message}`, "error");
        return; // Stop form submission if AI key is invalid
      }
    }

    await getJson(workspacePath("/config"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    log(`[${activeWorkspaceId}] configuration saved`);
    await refreshStatus();
    showToast("Configuration saved successfully", "success");
  } catch (err) {
    log(err.message);
    showToast(err.message, "error");
  }
});

if (generateAiAssistBtn) {
  generateAiAssistBtn.addEventListener("click", async () => {
    if (!activeWorkspaceId) return;
    const payload = {
      businessName: assistBusinessName?.value?.trim() || "",
      offer: assistOffer?.value?.trim() || "",
      targetAudience: assistAudience?.value?.trim() || "",
      goal: assistGoal?.value?.trim() || "",
      tone: assistTone?.value || "balanced",
      provider: form.elements.namedItem("AI_PROVIDER")?.value || "google",
      model: form.elements.namedItem("AI_MODEL")?.value || "",
      apiKey: form.elements.namedItem("AI_API_KEY")?.value || "",
    };
    generateAiAssistBtn.disabled = true;
    if (aiAssistResult) aiAssistResult.textContent = "Generating assist data...";
    try {
      const result = await getJson(workspacePath("/ai-data-assist"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const draft = result.draft || {};
      const setValue = (name, value) => {
        const el = form.elements.namedItem(name);
        if (el && value !== undefined && value !== null) {
          el.value = value;
        }
      };

      setValue("AI_PRODUCT_KNOWLEDGE", draft.productKnowledge || "");
      setValue("AI_CLOSING_STORY", draft.closingStory || "");
      setValue("AI_OBJECTION_PLAYBOOK", draft.objectionPlaybook || "");
      setValue("AI_FOLLOW_UP_TEMPLATE", draft.followUpTemplate || "");
      setValue("AI_WHATSAPP_STATUS_FEATURES_TEXT", draft.statusFeaturesText || "");
      setValue("AI_QUALIFICATION_FIELDS", draft.qualificationFields || "need,budget,timeline,decision-maker");
      setValue("AI_CLOSING_FLOW", draft.closingFlow || "balanced");
      setValue("AI_CLOSE_QUESTION_MODE", draft.closeQuestionMode || "warm_hot");
      setValue("AI_AUTO_STORY_TO_CLOSE", draft.autoStoryToClose || "true");
      setValue("AI_WHATSAPP_STATUS_FEATURES", draft.whatsappStatusFeatures || "true");
      setValue("AI_FOLLOW_UP_ENABLED", draft.followUpEnabled || "true");

      const source = result.source || "unknown";
      const warning = result.warning ? ` (fallback: ${result.warning})` : "";
      if (aiAssistResult) aiAssistResult.textContent = `Assist data generated via ${source}${warning}. Review and click Save Workspace Configuration.`;
      showToast("AI assist data generated", "success");
    } catch (err) {
      if (aiAssistResult) aiAssistResult.textContent = err.message;
      showToast(err.message, "error");
    } finally {
      generateAiAssistBtn.disabled = false;
    }
  });
}

if (postStatusNowBtn) {
  postStatusNowBtn.addEventListener("click", async () => {
    if (!activeWorkspaceId) return;
    postStatusNowBtn.disabled = true;
    if (statusPostResult) statusPostResult.textContent = "Posting status...";
    try {
      const result = await getJson(workspacePath("/status-post-now"), {
        method: "POST",
      });
      const preview = result?.posted?.text || "Status posted.";
      if (statusPostResult) statusPostResult.textContent = `Posted: ${preview.slice(0, 120)}${preview.length > 120 ? "..." : ""}`;
      showToast("Status posted successfully", "success");
      await refreshReports();
    } catch (err) {
      if (statusPostResult) statusPostResult.textContent = err.message;
      showToast(err.message, "error");
    } finally {
      postStatusNowBtn.disabled = false;
    }
  });
}

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
  if (customSendInFlight || workspaceSendInProgress) {
    log(`[${activeWorkspaceId}] campaign is already running.`);
    return;
  }
  if (!(workspaceReady || workspaceAuthenticated)) {
    log(`[${activeWorkspaceId}] WhatsApp client is not connected yet.`);
    return;
  }
  customSendInFlight = true;
  syncCampaignButtonState();
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
    const doneText = `[${activeWorkspaceId}] campaign finished. Sent ${messages.length} messages to ${recipientCount} recipients.`;
    log(doneText);
    showToast(doneText, "success");
    notifyDesktop("Campaign Completed", `Workspace ${activeWorkspaceId}: sent ${messages.length} messages to ${recipientCount} recipients.`);
    customForm.reset();
    updateMultiPreview();
    await refreshReports();
  } catch (err) {
    log(err.message);
    showToast(err.message, "error");
    notifyDesktop("Campaign Failed", err.message);
  } finally {
    customSendInFlight = false;
    await refreshStatus();
    syncCampaignButtonState();
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

// --- View Switching Logic ---
navItems.forEach(item => {
  item.addEventListener("click", () => {
    const target = item.getAttribute("data-view");
    if (target === "analytics") {
      refreshReports();
    }
    if (target === "leads") {
      loadLeads();
    }
    // Update nav active state
    navItems.forEach(i => i.classList.remove("active"));
    item.classList.add("active");

    // Show target view
    viewContainers.forEach(view => {
      if (view.id === `${target}View`) {
        view.classList.add("active");
      } else {
        view.classList.remove("active");
      }
    });

    // Auto-close sidebar on mobile after nav click
    if (window.innerWidth <= 768) {
      closeSidebar();
    }
  });
});

(async function init() {
  syncCampaignButtonState();
  setDefaultReportWindow();
  const ok = await checkAuth();
  if (ok) {
    await loadWorkspaces();
    await loadConfig();
    await refreshStatus();
    await refreshReports();
    if (window.lucide) window.lucide.createIcons();
  }
  setInterval(refreshStatus, 5000);
})();
// --- Leads Logic ---
const chatModal = document.getElementById("chatModal");
const chatModalMessages = document.getElementById("chatModalMessages");
const chatModalTitle = document.getElementById("chatModalTitle");
const chatModalSubtitle = document.getElementById("chatModalSubtitle");
const chatModalCount = document.getElementById("chatModalCount");
const chatModalMemoryDepth = document.getElementById("chatModalMemoryDepth");
const closeChatModalBtn = document.getElementById("closeChatModal");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
let activeChatContactId = null;

if (closeChatModalBtn) {
  closeChatModalBtn.addEventListener("click", () => {
    chatModal.style.display = "none";
    activeChatContactId = null;
  });
}

if (chatModal) {
  chatModal.addEventListener("click", (e) => {
    if (e.target === chatModal) {
      chatModal.style.display = "none";
      activeChatContactId = null;
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && chatModal && chatModal.style.display !== "none") {
    chatModal.style.display = "none";
    activeChatContactId = null;
  }
});

if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener("click", async () => {
    if (!activeChatContactId || !activeWorkspaceId) return;
    if (!confirm("Clear all conversation memory for this contact? The AI will lose context.")) return;
    try {
      await fetch(workspacePath(`/leads/${encodeURIComponent(activeChatContactId)}/history`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      chatModalMessages.innerHTML = '<div class="muted" style="text-align:center;font-size:13px;padding:24px;">History cleared. The AI will start fresh on the next message.</div>';
      chatModalCount.textContent = "0 messages";
      showToast("Conversation memory cleared", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

async function openChatModal(lead) {
  if (!chatModal || !activeWorkspaceId) return;
  activeChatContactId = lead.id;
  chatModalTitle.textContent = lead.name || lead.id;
  chatModalSubtitle.textContent = lead.id;
  chatModalMemoryDepth.textContent = "10";
  chatModalMessages.innerHTML = '<div class="muted" style="text-align:center;font-size:13px;padding:24px;">Loading history...</div>';
  chatModal.style.display = "flex";

  if (window.lucide) window.lucide.createIcons();

  try {
    const result = await getJson(workspacePath(`/leads/${encodeURIComponent(lead.id)}/history`));
    const history = result.history || [];

    chatModalCount.textContent = `${history.length} message${history.length !== 1 ? "s" : ""}`;

    if (history.length === 0) {
      chatModalMessages.innerHTML = '<div class="muted" style="text-align:center;font-size:13px;padding:24px;">No conversation history yet. Memory is built as the AI responds to this contact.</div>';
      return;
    }

    chatModalMessages.innerHTML = "";
    history.forEach((msg) => {
      const isAssistant = msg.role === "assistant";
      const bubble = document.createElement("div");
      bubble.className = `msg-bubble ${isAssistant ? "sent" : "received"}`;
      const ts = msg.ts ? new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      bubble.innerHTML = `
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 4px; opacity: 0.7;">${isAssistant ? "🤖 AI" : "👤 Customer"}</div>
        <div style="white-space: pre-wrap;">${msg.content}</div>
        ${ts ? `<div style="font-size: 10px; opacity: 0.5; margin-top: 4px; text-align: right;">${ts}</div>` : ""}
      `;
      chatModalMessages.appendChild(bubble);
    });
    chatModalMessages.scrollTop = chatModalMessages.scrollHeight;
  } catch (err) {
    chatModalMessages.innerHTML = `<div class="muted" style="text-align:center;font-size:13px;padding:24px;">Error: ${err.message}</div>`;
  }
}
async function loadLeads() {
  if (!activeWorkspaceId) return;
  try {
    const [result, summaryResult] = await Promise.all([
      getJson(workspacePath("/leads")),
      getJson(workspacePath("/leads/summary")),
    ]);
    if (!result.ok) throw new Error(result.error);
    renderLeads(result.leads || []);
    const s = summaryResult.summary || {};
    log(
      `[${activeWorkspaceId}] leads summary: total=${s.total || 0}, hot=${s.byStatus?.hot || 0}, warm=${s.byStatus?.warm || 0}, actionable=${s.actionable || 0}`
    );
  } catch (err) {
    log(`loadLeads error: ${err.message}`);
  }
}

function renderLeads(leads) {
  if (!leadsTableBody) return;
  leadsTableBody.innerHTML = "";

  if (leads.length === 0) {
    leadsEmptyState.style.display = "block";
    return;
  }

  leadsEmptyState.style.display = "none";

  // Sort leads by score first, then by status priority.
  const statusWeight = { hot: 3, warm: 2, cold: 1 };
  leads.sort((a, b) => {
    const scoreDelta = (b.score || 0) - (a.score || 0);
    if (scoreDelta !== 0) return scoreDelta;
    return (statusWeight[b.status] || 0) - (statusWeight[a.status] || 0);
  });

  leads.forEach(lead => {
    const tr = document.createElement("tr");
    const statusClass = `status-${lead.status || 'cold'}`;
    const score = Number.isFinite(Number(lead.score)) ? Math.max(0, Math.min(100, Number(lead.score))) : 0;
    const stage = lead.stage || "new";
    const date = new Date(lead.updatedAt).toLocaleString();

    tr.innerHTML = `
      <td>
        <div style="font-weight: 600;">${lead.name || lead.id}</div>
        <div class="muted" style="font-size: 11px;">${lead.id}</div>
      </td>
      <td><span class="badge ${statusClass}">${lead.status || 'cold'}</span></td>
      <td><span class="badge">${stage}</span></td>
      <td style="font-weight: 700;">${score}</td>
      <td style="max-width: 220px;"><div class="reason-cell" title="${lead.reason || ''}">${lead.reason || '-'}</div></td>
      <td style="max-width: 250px;"><div class="reason-cell" title="${lead.lastMessage || ''}">${lead.lastMessage || '-'}</div></td>
      <td class="muted" style="font-size: 12px;">${date}</td>
      <td>
        <button class="btn view-chat-btn" style="padding: 6px 12px; font-size: 12px; gap: 6px;" data-lead-id="${lead.id}">
          <i data-lucide="message-square"></i> Chat
        </button>
      </td>
    `;
    leadsTableBody.appendChild(tr);
  });

  // Wire up View Chat buttons
  leadsTableBody.querySelectorAll(".view-chat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const leadId = btn.getAttribute("data-lead-id");
      const lead = leads.find(l => l.id === leadId);
      if (lead) openChatModal(lead);
    });
  });

  // Re-init icons for the new chat buttons
  if (window.lucide) window.lucide.createIcons();
}

if (refreshLeadsBtn) {
  refreshLeadsBtn.addEventListener("click", loadLeads);
}
