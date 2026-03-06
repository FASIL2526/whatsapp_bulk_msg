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
const connectedPhoneEl = document.getElementById("connectedPhone");
const connectedPhoneWrap = document.getElementById("connectedPhoneWrap");
const logoutBtn2 = document.getElementById("logoutBtn2");

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
const mediaFileInput = document.getElementById("mediaFileInput");
const uploadMediaBtn = document.getElementById("uploadMediaBtn");
const uploadResult = document.getElementById("uploadResult");
const mediaListSelect = document.getElementById("mediaListSelect");
const sendAtInput = document.getElementById("sendAtInput");
const schedulesTableBody = document.getElementById("schedulesTableBody");
const schedulesEmpty = document.getElementById("schedulesEmpty");
const mediaTableBody = document.getElementById("mediaTableBody");
const mediaEmpty = document.getElementById("mediaEmpty");
const refreshSchedulesBtn = document.getElementById("refreshSchedulesBtn");
const refreshMediaBtn = document.getElementById("refreshMediaBtn");

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
let currentWorkspace = null;
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

function authHeaders() {
  return { Authorization: `Bearer ${authToken}` };
}

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
  messagePreview.innerHTML = `<div class="msg-bubble sent">${escapeHtml(lines[0]).replace(/\n/g, "<br>")}</div>`;
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
  if (m1) html += `<div class="msg-bubble sent" style="margin-bottom: 12px; border-bottom-left-radius: 0; align-self: flex-start; background: #fff; color: #333; border: 1px solid #ddd;"><b>Msg 1:</b><br>${escapeHtml(m1).replace(/\n/g, "<br>")}</div>`;
  if (m2) html += `<div class="msg-bubble sent" style="margin-top: 4px; align-self: flex-start; background: #e5e5e5; color: #000; border: 1px solid #d0d0d0;"><b>Msg 2:</b><br>${escapeHtml(m2).replace(/\n/g, "<br>")}</div>`;

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
  if (!events) return;
  const ts = new Date().toLocaleTimeString();
  events.textContent = `[${ts}] ${message}\n${events.textContent}`.slice(0, 9000);
}

function showToast(message, variant = "info") {
  const toast = document.createElement("div");
  const bg = variant === "error" ? "#dc2626" : variant === "success" ? "#111111" : "#333333";
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
  let data;
  try {
    data = await res.json();
  } catch {
    if (res.status === 401) { clearAuth(); }
    throw new Error(`Server error (${res.status})`);
  }
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
  if (authShell) authShell.style.display = "none";
  if (sidebar) sidebar.style.display = "flex";
  const mainLayout = document.querySelector("main.layout");
  if (mainLayout) mainLayout.style.display = "flex";
  if (userPill) userPill.textContent = user.username;
  // Show admin nav if super admin (username === 'admin' by default)
  const adminNav = document.getElementById("adminNavItem");
  if (adminNav) adminNav.style.display = (user.username === "admin") ? "" : "none";
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
  if (authShell) authShell.style.display = "flex";
  if (sidebar) sidebar.style.display = "none";
  const mainLayout = document.querySelector("main.layout");
  if (mainLayout) mainLayout.style.display = "none";
  if (userPill) userPill.textContent = "-";
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

    // Fetch the full analytics endpoint
    const data = await getJson(workspacePath(`/reports/analytics${suffix}`));
    const s = data.summary || {};

    // ── Message stats cards ──────────────────────────────────
    if (reportTotal) reportTotal.textContent = s.total || 0;
    if (reportSentOk) reportSentOk.textContent = s.sentOk || 0;
    if (reportSentFailed) reportSentFailed.textContent = s.sentFailed || 0;
    if (reportAutoReplies) reportAutoReplies.textContent = s.autoReplies || 0;
    const followUpsEl = document.getElementById("reportFollowUps");
    const autoStatusesEl = document.getElementById("reportAutoStatuses");
    if (followUpsEl) followUpsEl.textContent = s.followUps || 0;
    if (autoStatusesEl) autoStatusesEl.textContent = s.autoStatuses || 0;

    // Overview tab
    if (overviewTotal) overviewTotal.textContent = s.total || 0;
    if (overviewRate) {
      const rate = s.total > 0 ? Math.round((s.sentOk / s.total) * 100) : 0;
      overviewRate.textContent = `${rate}%`;
    }

    exportCsvLink.href = workspacePath(`/reports/csv${suffix}`);

    // ── Revenue overview ────────────────────────────────────
    const a = data.attribution || {};
    const cur = a.currency || "USD";
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt("anTotalRevenue", `${cur} ${(a.totalRevenue || 0).toLocaleString()}`);
    setTxt("anWeeklyRevenue", `${cur} ${(data.weeklyRevenue || 0).toLocaleString()}`);
    setTxt("anMonthlyRevenue", `${cur} ${(data.monthlyRevenue || 0).toLocaleString()}`);
    setTxt("anAvgDeal", `${cur} ${(a.avgDealSize || 0).toLocaleString()}`);
    setTxt("anROI", a.roi || "N/A");

    // ── Lead funnel ─────────────────────────────────────────
    const p = data.pipeline || {};
    const funnelEl = document.getElementById("leadFunnelBars");
    if (funnelEl) {
      const stages = [
        { label: "New", value: p.new || 0, color: "#111111" },
        { label: "Qualified", value: p.qualified || 0, color: "#333333" },
        { label: "Proposal", value: p.proposal || 0, color: "#555555" },
        { label: "Booking", value: p.booking || 0, color: "#777777" },
        { label: "Won", value: p.closedWon || 0, color: "#999999" },
        { label: "Lost", value: p.closedLost || 0, color: "#bbbbbb" },
      ];
      const maxVal = Math.max(1, ...stages.map(x => x.value));
      funnelEl.innerHTML = stages.map(st => {
        const pct = Math.max(2, Math.round((st.value / maxVal) * 100));
        return `<div class="funnel-row">
          <span class="funnel-label">${st.label}</span>
          <div class="funnel-bar-bg">
            <div class="funnel-bar-fill" style="width:${pct}%;background:${st.color};"><span>${st.value}</span></div>
          </div>
        </div>`;
      }).join("");
    }
    setTxt("anConvRate", `${a.conversionRate || 0}%`);
    setTxt("anDaysClose", `${a.avgDaysToClose || 0}d`);
    setTxt("anRevPerLead", `${cur} ${(a.revenuePerLead || 0).toLocaleString()}`);

    // ── Lead temperature ────────────────────────────────────
    const tempEl = document.getElementById("leadTempBars");
    if (tempEl) {
      const temps = [
        { icon: "🔥", label: "Hot", value: p.hot || 0, color: "#111111" },
        { icon: "🌡️", label: "Warm", value: p.warm || 0, color: "#777777" },
        { icon: "❄️", label: "Cold", value: p.cold || 0, color: "#bbbbbb" },
      ];
      const maxT = Math.max(1, ...temps.map(x => x.value));
      tempEl.innerHTML = temps.map(t => {
        const pct = Math.max(2, Math.round((t.value / maxT) * 100));
        return `<div class="temp-row">
          <span class="temp-icon">${t.icon}</span>
          <div class="temp-bar-bg">
            <div class="temp-bar-fill" style="width:${pct}%;background:${t.color};"><span>${t.label}</span></div>
          </div>
          <span class="temp-count">${t.value}</span>
        </div>`;
      }).join("");
    }

    // ── Win / Loss ──────────────────────────────────────────
    const f = data.feedback;
    if (f) {
      setTxt("anWinRate", `${f.winRate || 0}%`);
      setTxt("anWonCount", f.wonCount || 0);
      setTxt("anLostCount", f.lostCount || 0);
      const insightEl = document.getElementById("anScoringInsight");
      if (insightEl && f.insight) {
        insightEl.style.display = "block";
        insightEl.innerHTML = `<strong>💡 Insight:</strong> ${escapeHtml(f.insight)}`;
      }
    } else {
      setTxt("anWinRate", "—");
      setTxt("anWonCount", "0");
      setTxt("anLostCount", "0");
    }

    // ── Activity by source ──────────────────────────────────
    const srcEl = document.getElementById("sourceBreakdown");
    if (srcEl && s.bySource) {
      const entries = Object.entries(s.bySource).sort((a, b) => b[1] - a[1]);
      if (entries.length === 0) {
        srcEl.innerHTML = '<span class="muted">No activity data yet.</span>';
      } else {
        const maxS = Math.max(1, ...entries.map(e => e[1]));
        srcEl.innerHTML = entries.map(([source, count]) => {
          const pct = Math.max(2, Math.round((count / maxS) * 100));
          return `<div class="source-row">
            <span class="source-label">${escapeHtml(source)}</span>
            <div class="source-bar-bg">
              <div class="source-bar-fill" style="width:${pct}%;"><span>${count}</span></div>
            </div>
          </div>`;
        }).join("");
      }
    }

    // ── Top converting tags ─────────────────────────────────
    const tagsEl = document.getElementById("topTagsList");
    if (tagsEl && f && f.topConvertingTags && f.topConvertingTags.length > 0) {
      tagsEl.innerHTML = f.topConvertingTags.map(t => {
        return `<div class="tag-row">
          <span class="tag-badge">${escapeHtml(t.tag)}</span>
          <div class="tag-bar-bg"><div class="tag-bar-fill" style="width:${t.pct}%;"></div></div>
          <span class="tag-pct">${t.pct}%</span>
        </div>`;
      }).join("");
    } else if (tagsEl) {
      tagsEl.innerHTML = '<span class="muted">Need closed-won leads for tag analysis.</span>';
    }

    // ── Daily volume chart ──────────────────────────────────
    const chartEl = document.getElementById("dailyVolumeChart");
    const legendEl = document.getElementById("dailyVolumeLegend");
    if (chartEl && data.dailyVolume) {
      const days = Object.entries(data.dailyVolume).sort((a, b) => a[0].localeCompare(b[0]));
      if (days.length === 0) {
        chartEl.innerHTML = '<span class="muted">No daily data in this range.</span>';
        if (legendEl) legendEl.style.display = "none";
      } else {
        const maxD = Math.max(1, ...days.map(([, d]) => d.sent + d.received + d.failed));
        const chartHeight = 100; // px
        chartEl.innerHTML = days.map(([day, d]) => {
          const total = d.sent + d.received + d.failed;
          const hSent = Math.round((d.sent / maxD) * chartHeight);
          const hRecv = Math.round((d.received / maxD) * chartHeight);
          const hFail = Math.round((d.failed / maxD) * chartHeight);
          const label = day.slice(5); // MM-DD
          return `<div class="daily-volume-bar-group" title="${day}: ${d.sent} sent, ${d.received} recv, ${d.failed} fail">
            <div class="daily-volume-bar-stack" style="height:${Math.max(4, Math.round((total / maxD) * chartHeight))}px;">
              ${hSent > 0 ? `<div class="bar-segment" style="height:${hSent}px;background:var(--primary);"></div>` : ""}
              ${hRecv > 0 ? `<div class="bar-segment" style="height:${hRecv}px;background:var(--accent);"></div>` : ""}
              ${hFail > 0 ? `<div class="bar-segment" style="height:${hFail}px;background:var(--danger);"></div>` : ""}
            </div>
            <span class="bar-label">${label}</span>
          </div>`;
        }).join("");
        if (legendEl) legendEl.style.display = "flex";
      }
    }

    // ── Recent activity table ───────────────────────────────
    const actBody = document.getElementById("recentActivityBody");
    if (actBody && data.recentLogs) {
      if (data.recentLogs.length === 0) {
        actBody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;">No recent activity.</td></tr>';
      } else {
        actBody.innerHTML = data.recentLogs.map(r => {
          const time = new Date(r.at).toLocaleString();
          const kindLabel = (r.kind || "").replace(/_/g, " ");
          const statusDot = r.ok
            ? '<span style="color:var(--primary);font-weight:700;">✓</span>'
            : '<span style="color:var(--danger);font-weight:700;">✗</span>';
          return `<tr>
            <td style="font-size:12px;white-space:nowrap;">${time}</td>
            <td><span style="font-size:12px;font-family:var(--font-mono);">${escapeHtml(kindLabel)}</span></td>
            <td style="font-size:12px;">${escapeHtml(r.source || '')}</td>
            <td>${statusDot}</td>
            <td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.message || '—')}</td>
          </tr>`;
        }).join("");
      }
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
    option.textContent = ws.name;
    workspaceSelect.appendChild(option);
  }

  activeWorkspaceId = result.workspaces.find((ws) => ws.id === previous)?.id || result.workspaces[0]?.id || "";
  currentWorkspace = result.workspaces.find((ws) => ws.id === activeWorkspaceId) || null;
  if (activeWorkspaceId) {
    workspaceSelect.value = activeWorkspaceId;
  }
}

async function loadMediaList() {
  if (!activeWorkspaceId) return;
  try {
    const data = await getJson(workspacePath("/media"));
    const list = data.media || [];

    // Populate the <select> dropdown
    mediaListSelect.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "(none)";
    mediaListSelect.appendChild(none);
    for (const m of list) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.filename} (${m.mimeType})`;
      mediaListSelect.appendChild(opt);
    }

    // Render the media library table with delete buttons + file sizes
    if (mediaTableBody) {
      mediaTableBody.innerHTML = "";
      if (list.length === 0) {
        if (mediaEmpty) mediaEmpty.style.display = "block";
      } else {
        if (mediaEmpty) mediaEmpty.style.display = "none";
        for (const m of list) {
          const sizeLabel = formatFileSize(m.sizeBytes || 0);
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td style="font-weight:600;">${escapeHtml(m.filename)}</td>
            <td class="muted">${escapeHtml(m.mimeType)}</td>
            <td class="muted" style="font-size:12px;">${sizeLabel}</td>
            <td class="muted" style="font-size:12px;">${new Date(m.uploadedAt).toLocaleString()}</td>
            <td>
              <button class="btn del-media-btn" data-id="${m.id}" style="padding:3px 8px;font-size:11px;color:var(--danger);border-color:var(--danger);">✕ Delete</button>
            </td>
          `;
          mediaTableBody.appendChild(tr);
        }
      }
      // Wire delete buttons
      mediaTableBody.querySelectorAll(".del-media-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this media file? This cannot be undone.")) return;
          try {
            await getJson(workspacePath(`/media/${btn.dataset.id}`), { method: "DELETE", headers: authHeaders() });
            showToast("Media deleted", "success");
            await loadMediaList();
          } catch (e) { showToast(e.message, "error"); }
        });
      });
    }

    // Load and display storage usage bar
    loadStorageUsage();
  } catch (err) {
    console.warn("Failed to load media list:", err.message);
  }
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

async function loadStorageUsage() {
  if (!activeWorkspaceId) return;
  try {
    const data = await getJson(workspacePath("/media/storage"));
    const s = data.storage;
    const barWrap = document.getElementById("storageBarWrap");
    const barText = document.getElementById("storageBarText");
    const barPercent = document.getElementById("storageBarPercent");
    const barFill = document.getElementById("storageBarFill");
    const label = document.getElementById("storageUsageLabel");

    if (barWrap) barWrap.style.display = "block";
    if (barText) barText.textContent = `${s.usedMB} MB / ${s.limitMB} MB (${s.fileCount} files)`;
    if (barPercent) barPercent.textContent = `${s.usedPercent}%`;
    if (barFill) {
      barFill.style.width = `${s.usedPercent}%`;
      barFill.style.background = s.usedPercent >= 90 ? "var(--danger)" : s.usedPercent >= 70 ? "var(--accent)" : "var(--primary)";
    }
    if (label) label.textContent = `${s.plan} plan · ${s.usedMB}/${s.limitMB} MB`;
  } catch (_) {}
}

async function loadSchedules() {
  if (!activeWorkspaceId) return;
  try {
    const data = await getJson(workspacePath("/schedules"));
    const list = (data.scheduled || []).slice().reverse();

    if (!schedulesTableBody) return;
    schedulesTableBody.innerHTML = "";

    if (list.length === 0) {
      if (schedulesEmpty) schedulesEmpty.style.display = "block";
      return;
    }
    if (schedulesEmpty) schedulesEmpty.style.display = "none";

    for (const s of list) {
      const tr = document.createElement("tr");
      const statusColor = s.status === "sent" ? "var(--primary)" : s.status === "failed" ? "var(--danger)" : s.status === "cancelled" ? "var(--muted)" : "var(--accent)";
      tr.innerHTML = `
        <td><code style="font-size:11px;">${escapeHtml(s.id)}</code></td>
        <td style="max-width:220px;"><div class="reason-cell">${escapeHtml(s.message || '(media only)')}</div></td>
        <td class="muted">${escapeHtml(s.mediaId || '-')}</td>
        <td class="muted" style="font-size:12px;">${new Date(s.sendAt).toLocaleString()}</td>
        <td><span class="badge" style="color:${statusColor};border-color:${statusColor};">${s.status}</span></td>
        <td>${s.status === "pending" ? `<button class="btn cancel-sched-btn" data-id="${s.id}" style="padding:4px 10px;font-size:11px;color:var(--danger);border-color:var(--danger);">Cancel</button>` : "-"}</td>
      `;
      schedulesTableBody.appendChild(tr);
    }

    // Wire cancel buttons
    schedulesTableBody.querySelectorAll(".cancel-sched-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        try {
          await getJson(workspacePath(`/schedules/${id}`), { method: "DELETE" });
          showToast("Scheduled message cancelled", "success");
          await loadSchedules();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  } catch (err) {
    console.warn("Failed to load schedules:", err.message);
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
    // Connected WhatsApp number
    if (connectedPhoneEl && connectedPhoneWrap) {
      if (status.connectedPhone && status.ready) {
        connectedPhoneEl.textContent = "+" + status.connectedPhone.replace(/@.*$/, "");
        connectedPhoneWrap.style.display = "block";
      } else {
        connectedPhoneEl.textContent = "";
        connectedPhoneWrap.style.display = "none";
      }
    }
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
  if (connectTimer) connectTimer.textContent = `Connect timer: ${connectElapsedSec}s`;
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
  currentWorkspace = { id: activeWorkspaceId };
  await loadConfig();
  await refreshStatus();
  await refreshReports();
  await loadMediaList();
  await loadSchedules();
});

if (createWorkspaceBtn) {
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
    currentWorkspace = result.workspace;
    workspaceSelect.value = activeWorkspaceId;
    await loadConfig();
    await refreshStatus();
    log(`workspace created: ${result.workspace.name}`);
  } catch (err) {
    log(err.message);
  }
});
}

if (form) {
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = formToObject(form);

    // API Validation for AI Sales Closer
    if (payload.AI_SALES_ENABLED === "true" && (payload.AI_API_KEY || payload.AI_PROVIDER === "ollama")) {
      const provider = payload.AI_PROVIDER || "google";
      log(`[${activeWorkspaceId}] Validating AI Key for ${provider} (${payload.AI_MODEL})...`);
      try {
        const validation = await getJson(workspacePath("/validate-ai-key"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: payload.AI_API_KEY || "",
            model: payload.AI_MODEL,
            provider: provider,
            ollamaBaseUrl: payload.OLLAMA_BASE_URL || ""
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
}

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
      ollamaBaseUrl: form.elements.namedItem("OLLAMA_BASE_URL")?.value || "",
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

if (startBtn) {
startBtn.addEventListener("click", async () => {
  try {
    await getJson(workspacePath("/start"), { method: "POST" });
    log(`[${activeWorkspaceId}] starting client...`);
    await refreshStatus();
  } catch (err) {
    log(err.message);
  }
});
}

if (stopBtn) {
stopBtn.addEventListener("click", async () => {
  try {
    await getJson(workspacePath("/stop"), { method: "POST" });
    log(`[${activeWorkspaceId}] client stopped`);
    await refreshStatus();
  } catch (err) {
    log(err.message);
  }
});
}

if (logoutBtn2) {
  logoutBtn2.addEventListener("click", async () => {
    if (!activeWorkspaceId) return;
    if (!confirm("This will log out the current WhatsApp number and clear the session.\nYou can then start the client again to scan a new QR with a different number.\n\nContinue?")) return;
    try {
      const result = await getJson(workspacePath("/logout"), { method: "POST" });
      log(`[${activeWorkspaceId}] ${result.message || "Logged out successfully"}`);
      showToast("Logged out. Start client to connect a new number.", "success");
      await refreshStatus();
    } catch (err) {
      log(err.message);
      showToast(err.message, "error");
    }
  });
}

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

if (customForm) {
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
    const mediaId = mediaListSelect?.value || "";
    const sendAtVal = sendAtInput?.value || "";

    if (messages.length === 0 && !mediaId) {
      log("Please enter at least one message or attach media.");
      showToast("Add a message or attach media first.", "error");
      return;
    }

    log(`[${activeWorkspaceId}] launching campaign...`);
    const payload = { messages };
    if (mediaId) payload.mediaId = mediaId;
    if (sendAtVal) payload.sendAt = new Date(sendAtVal).toISOString();

    // Include recipients override if numbers entered on campaign page
    const instantRecipientsEl = document.getElementById("instantRecipients");
    const recipientsRaw = (instantRecipientsEl?.value || "").trim();
    if (recipientsRaw) {
      payload.recipients = recipientsRaw.split(/[\n,]/).map(n => n.trim()).filter(Boolean);
    }

    const result = await getJson(workspacePath("/send-custom"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Scheduled for later
    if (result.scheduled) {
      const when = new Date(result.scheduled.sendAt).toLocaleString();
      const schedText = `[${activeWorkspaceId}] campaign scheduled for ${when}`;
      log(schedText);
      showToast(schedText, "success");
      notifyDesktop("Campaign Scheduled", schedText);
    } else {
      // Sent immediately — show progress
      const total = (result.results || []).length;
      let current = 0;
      const interval = setInterval(() => {
        current += 1;
        updateProgressBar(current, total);
        if (current >= total) clearInterval(interval);
      }, 100);
      const recipientCount = messages.length > 0 ? Math.ceil(total / messages.length) : total;
      const doneText = `[${activeWorkspaceId}] campaign finished. Sent ${messages.length || 1} message(s) to ${recipientCount} recipient(s).`;
      log(doneText);
      showToast(doneText, "success");
      notifyDesktop("Campaign Completed", doneText);
    }
    customForm.reset();
    updateMultiPreview();
    if (mediaListSelect) mediaListSelect.value = "";
    if (sendAtInput) sendAtInput.value = "";
    await refreshReports();
    await loadSchedules();
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
} // end customForm null guard

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

  // Media upload handler
  if (uploadMediaBtn && mediaFileInput) {
    uploadMediaBtn.addEventListener("click", async () => {
      if (!mediaFileInput.files?.length) {
        if (uploadResult) uploadResult.textContent = "Select a file first.";
        return;
      }
      try {
        if (uploadResult) uploadResult.textContent = "Uploading...";
        const formData = new FormData();
        formData.set("file", mediaFileInput.files[0]);
        const res = await fetch(workspacePath("/media"), {
          method: "POST",
          headers: { "Authorization": `Bearer ${authToken}` },
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error || "Upload failed");
        if (uploadResult) uploadResult.textContent = "Uploaded";
        await loadMediaList();
        setTimeout(() => { if (uploadResult) uploadResult.textContent = ""; }, 2500);
      } catch (err) {
        if (uploadResult) uploadResult.textContent = err.message;
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
      loadConversationAnalytics();
    }
    if (target === "leads") {
      loadLeads();
    }
    if (target === "campaigns") {
      loadMediaList();
      loadSchedules();
      loadCampaignHistory();
      loadTemplateLibrary();
      populateCampMediaSelect();
      populateCampTemplateSelect();
      loadAutoReplySettings();
    }
    if (target === "automation") {
      loadAutomation();
    }
    if (target === "agent") {
      loadAgent();
    }
    if (target === "alerts") {
      loadAlerts();
    }
    if (target === "livechat") {
      loadLiveChat();
    }
    if (target === "billing") {
      loadBilling();
    }
    if (target === "admin") {
      loadAdminPanel();
      loadBackupPanel();
    }
    if (target === "tools") {
      loadToolsView();
    }
    if (target === "knowledgebase") {
      loadKnowledgeBase();
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
    await loadMediaList();
    await loadSchedules();
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
    renderLeadCharts(result.leads || []);
    const s = summaryResult.summary || {};
    renderLeadStats(result.leads || [], s);
    log(
      `[${activeWorkspaceId}] leads summary: total=${s.total || 0}, hot=${s.byStatus?.hot || 0}, warm=${s.byStatus?.warm || 0}, actionable=${s.actionable || 0}`
    );
  } catch (err) {
    log(`loadLeads error: ${err.message}`);
  }
}

function renderLeadStats(leads, summary) {
  const el = document.getElementById("leadStatsCards");
  if (!el) return;
  const total = leads.length;
  const hot = leads.filter(l => l.status === "hot").length;
  const warm = leads.filter(l => l.status === "warm").length;
  const cold = leads.filter(l => l.status === "cold").length;
  const avgScore = total ? Math.round(leads.reduce((s, l) => s + (l.score || 0), 0) / total) : 0;
  const assigned = leads.filter(l => l.assignedTo).length;
  el.innerHTML = `
    <div class="kpi-card"><div class="kpi-value">${total}</div><div class="kpi-label">Total</div></div>
    <div class="kpi-card"><div class="kpi-value">${hot}</div><div class="kpi-label">Hot</div></div>
    <div class="kpi-card"><div class="kpi-value">${warm}</div><div class="kpi-label">Warm</div></div>
    <div class="kpi-card"><div class="kpi-value">${cold}</div><div class="kpi-label">Cold</div></div>
    <div class="kpi-card"><div class="kpi-value">${avgScore}</div><div class="kpi-label">Avg Score</div></div>
    <div class="kpi-card"><div class="kpi-value">${assigned}</div><div class="kpi-label">Assigned</div></div>
  `;
}

let _leadStatusChart = null;
let _leadStageChart = null;

function renderLeadCharts(leads) {
  // Status distribution (doughnut)
  const statusCounts = { hot: 0, warm: 0, cold: 0 };
  leads.forEach(l => { statusCounts[l.status || "cold"] = (statusCounts[l.status || "cold"] || 0) + 1; });
  const statusCtx = document.getElementById("leadStatusChart");
  if (statusCtx && window.Chart) {
    if (_leadStatusChart) _leadStatusChart.destroy();
    _leadStatusChart = new Chart(statusCtx, {
      type: "doughnut",
      data: {
        labels: ["Hot", "Warm", "Cold"],
        datasets: [{
          data: [statusCounts.hot, statusCounts.warm, statusCounts.cold],
          backgroundColor: ["#111111", "#888888", "#cccccc"],
          borderColor: ["#111111", "#888888", "#cccccc"],
          borderWidth: 1,
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: "bottom", labels: { padding: 16, usePointStyle: true, pointStyle: 'circle' } } } }
    });
  }

  // Stage pipeline (bar)
  const stageOrder = ["new", "qualified", "proposal", "booking", "closed_won", "closed_lost"];
  const stageCounts = {};
  stageOrder.forEach(s => stageCounts[s] = 0);
  leads.forEach(l => { const s = l.stage || "new"; stageCounts[s] = (stageCounts[s] || 0) + 1; });
  const stageCtx = document.getElementById("leadStageChart");
  if (stageCtx && window.Chart) {
    if (_leadStageChart) _leadStageChart.destroy();
    _leadStageChart = new Chart(stageCtx, {
      type: "bar",
      data: {
        labels: stageOrder.map(s => s.replace(/_/g, " ")),
        datasets: [{
          label: "Leads",
          data: stageOrder.map(s => stageCounts[s]),
          backgroundColor: ["#111111", "#333333", "#555555", "#777777", "#999999", "#bbbbbb"],
          borderColor: "transparent",
          borderRadius: 4,
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } } }
    });
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
    const tags = (lead.tags || []).map(t => `<span class="badge" style="font-size:10px;padding:2px 6px;">${escapeHtml(t)}</span>`).join(" ");
    const lang = escapeHtml(lead.language || "");
    const assigned = escapeHtml(lead.assignedTo || "");

    tr.innerHTML = `
      <td>
        <div style="font-weight: 600;">${escapeHtml(lead.name || lead.id)}</div>
        <div class="muted" style="font-size: 11px;">${escapeHtml(lead.id)}</div>
      </td>
      <td><span class="badge ${statusClass}">${escapeHtml(lead.status || 'cold')}</span></td>
      <td><span class="badge">${escapeHtml(stage)}</span></td>
      <td style="font-weight: 700;">${score}</td>
      <td style="max-width:150px;">${tags || '<span class="muted">-</span>'}</td>
      <td class="muted" style="font-size:12px;">${assigned || '-'}</td>
      <td class="muted" style="font-size:12px;">${lang || '-'}</td>
      <td style="max-width: 200px;"><div class="reason-cell" title="${escapeHtml(lead.reason || '')}">${escapeHtml(lead.reason || '-')}</div></td>
      <td style="max-width: 200px;"><div class="reason-cell" title="${escapeHtml(lead.lastMessage || '')}">${escapeHtml(lead.lastMessage || '-')}</div></td>
      <td class="muted" style="font-size: 12px;">${date}</td>
      <td style="white-space:nowrap;">
        <button class="btn view-chat-btn" style="padding:4px 8px;font-size:11px;" data-lead-id="${escapeHtml(lead.id)}">
          <i data-lucide="message-square" style="width:12px;height:12px;"></i>
        </button>
        <button class="btn view-detail-btn" style="padding:4px 8px;font-size:11px;" data-lead-id="${escapeHtml(lead.id)}">
          <i data-lucide="eye" style="width:12px;height:12px;"></i>
        </button>
      </td>
    `;
    leadsTableBody.appendChild(tr);
  });

  leadsTableBody.querySelectorAll(".view-chat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const leadId = btn.getAttribute("data-lead-id");
      const lead = leads.find(l => l.id === leadId);
      if (lead) openChatModal(lead);
    });
  });

  leadsTableBody.querySelectorAll(".view-detail-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const leadId = btn.getAttribute("data-lead-id");
      const lead = leads.find(l => l.id === leadId);
      if (lead) openLeadDetail(lead);
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

if (refreshLeadsBtn) {
  refreshLeadsBtn.addEventListener("click", loadLeads);
}

if (refreshSchedulesBtn) {
  refreshSchedulesBtn.addEventListener("click", loadSchedules);
}

if (refreshMediaBtn) {
  refreshMediaBtn.addEventListener("click", loadMediaList);
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── Automation Hub Logic ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Wrapper around fetch that auto-injects the auth header
function apiFetch(url, options) {
  const opts = { ...(options || {}) };
  opts.headers = { ...(opts.headers || {}) };
  if (authToken) opts.headers.Authorization = `Bearer ${authToken}`;
  return fetch(url, opts);
}

const AUTOMATION_FEATURES = [
  { key: "NURTURE_DRIP_ENABLED",       label: "Nurture Drip",        icon: "droplets",        desc: "Multi-day lead sequences" },
  { key: "AUTO_REENGAGE_ENABLED",      label: "Re-engagement",       icon: "rotate-ccw",      desc: "Win back stale leads" },
  { key: "AUTO_ESCALATION_ENABLED",    label: "Auto Escalation",     icon: "alert-triangle",  desc: "Alert human operators" },
  { key: "AUTO_LEAD_ROUTING_ENABLED",  label: "Lead Routing",        icon: "git-branch",      desc: "Auto-assign strategies" },
  { key: "AB_TEST_ENABLED",            label: "A/B Testing",         icon: "split",           desc: "Test message variants" },
  { key: "AUTO_DAILY_DIGEST_ENABLED",  label: "Daily Digest",        icon: "newspaper",       desc: "Morning pipeline summary" },
  { key: "AUTO_OBJECTION_ENABLED",     label: "Objection Recovery",  icon: "shield",          desc: "Auto-counter objections" },
  { key: "AUTO_CLEANUP_ENABLED",       label: "Conversation Cleanup",icon: "trash",           desc: "Archive dead conversations" },
  { key: "AUTO_TIMEZONE_ENABLED",      label: "Timezone Send",       icon: "clock",           desc: "Send at optimal hours" },
  { key: "AUTO_TAGGING_ENABLED",       label: "Auto Tag & Segment",  icon: "tags",            desc: "AI labels on leads" },
];

async function loadAutomation() {
  if (!currentWorkspace || !authToken) return;
  const wsId = currentWorkspace.id;

  // Load automation config
  try {
    const resp = await apiFetch(`/api/workspaces/${wsId}/automation/config`);
    const data = await resp.json();
    if (data.ok) {
      renderAutomationToggles(data.automation);
      renderDripSteps(data.automation?.nurtureDrip);
    }
  } catch (e) { console.error("Automation config load error:", e); }

  // Load A/B tests
  loadAbTests();
  // Load routing
  loadRouting();
  // Load tags
  loadTags();
}

// ─── Drip Step Preview ─────────────────────────────────────────────────────
function renderDripSteps(drip) {
  const container = document.getElementById("dripSteps");
  if (!container) return;
  const steps = drip?.steps || [];
  if (steps.length === 0) {
    container.innerHTML = '<span class="muted">Default 5-step sequence (Day 0, 1, 3, 5, 7). Enable drip to customize.</span>';
    return;
  }
  container.innerHTML = steps.map((s, i) =>
    `<div style="padding:6px 0;border-bottom:1px solid var(--panel-border);font-size:13px;">
      <strong>Step ${i + 1}</strong> — Day ${s.delayDays}: <span class="muted">${escapeHtml(s.message.slice(0, 80))}${s.message.length > 80 ? "…" : ""}</span>
    </div>`
  ).join("");
}

function renderAutomationToggles(automation) {
  const container = document.getElementById("automationToggles");
  if (!container) return;

  // Get current workspace config to read toggle states
  const wsId = currentWorkspace?.id;
  container.innerHTML = AUTOMATION_FEATURES.map(f => {
    const isEnabled = currentWorkspace?.config?.[f.key] === "true" ||
      (automation && getNestedEnabled(automation, f.key));
    return `
      <div class="automation-card ${isEnabled ? "enabled" : ""}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <i data-lucide="${f.icon}" style="width:20px;height:20px;flex-shrink:0;"></i>
          <strong style="font-size:14px;">${f.label}</strong>
        </div>
        <p class="muted" style="font-size:12px;margin-bottom:12px;">${f.desc}</p>
        <label class="toggle-switch" style="cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;">
          <input type="checkbox" ${isEnabled ? "checked" : ""} data-config-key="${f.key}" class="automation-toggle" />
          <span>${isEnabled ? "On" : "Off"}</span>
        </label>
      </div>
    `;
  }).join("");

  // Bind toggle events
  container.querySelectorAll(".automation-toggle").forEach(cb => {
    cb.addEventListener("change", async () => {
      const key = cb.dataset.configKey;
      const val = cb.checked ? "true" : "false";
      const label = cb.closest(".automation-card")?.querySelector("span");
      if (label) label.textContent = cb.checked ? "On" : "Off";
      cb.closest(".automation-card")?.classList.toggle("enabled", cb.checked);
      // Save to workspace config
      try {
        const current = await (await apiFetch(`/api/workspaces/${wsId}/config`)).json();
        current[key] = val;
        await apiFetch(`/api/workspaces/${wsId}/config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(current),
        });
      } catch (e) { console.error("Toggle save error:", e); }
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

function getNestedEnabled(automation, key) {
  const map = {
    NURTURE_DRIP_ENABLED: automation.nurtureDrip?.enabled,
    AUTO_REENGAGE_ENABLED: automation.reengage?.enabled,
    AUTO_ESCALATION_ENABLED: automation.escalation?.enabled,
    AUTO_LEAD_ROUTING_ENABLED: automation.leadRouting?.enabled,
    AB_TEST_ENABLED: automation.abTesting?.enabled,
    AUTO_DAILY_DIGEST_ENABLED: automation.dailyDigest?.enabled,
    AUTO_OBJECTION_ENABLED: automation.objection?.enabled,
    AUTO_CLEANUP_ENABLED: automation.cleanup?.enabled,
    AUTO_TIMEZONE_ENABLED: automation.timezone?.enabled,
    AUTO_TAGGING_ENABLED: automation.tagging?.enabled,
  };
  return map[key] || false;
}

// ─── Enroll All in Drip ────────────────────────────────────────────────────
const enrollAllDripBtn = document.getElementById("enrollAllDripBtn");
if (enrollAllDripBtn) {
  enrollAllDripBtn.addEventListener("click", async () => {
    if (!currentWorkspace) return;
    try {
      const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/automation/drip/enroll-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await resp.json();
      alert(data.ok ? `Enrolled ${data.enrolled} leads into drip sequence.` : (data.error || "Failed"));
    } catch (e) { alert("Error: " + e.message); }
  });
}

// ─── A/B Test form ─────────────────────────────────────────────────────────
const abTestForm = document.getElementById("abTestForm");
if (abTestForm) {
  abTestForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentWorkspace) return;
    const name = document.getElementById("abTestName")?.value?.trim() || "A/B Test";
    const raw = document.getElementById("abTestVariants")?.value || "";
    const messages = raw.split("\n").map(s => s.trim()).filter(Boolean);
    if (messages.length < 2) return alert("Enter at least 2 message variants (one per line).");
    try {
      const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/automation/ab-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, messages }),
      });
      const data = await resp.json();
      if (data.ok) {
        alert("A/B test created!");
        loadAbTests();
        document.getElementById("abTestName").value = "";
        document.getElementById("abTestVariants").value = "";
      } else {
        alert(data.error || "Failed");
      }
    } catch (e) { alert("Error: " + e.message); }
  });
}

async function loadAbTests() {
  if (!currentWorkspace) return;
  try {
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/automation/ab-test`);
    const data = await resp.json();
    const container = document.getElementById("abTestResults");
    if (!container || !data.ok) return;
    const tests = data.tests || [];
    if (tests.length === 0) {
      container.innerHTML = '<span class="muted">No tests yet.</span>';
      return;
    }
    container.innerHTML = tests.map(t => {
      const variants = (t.variants || []).map(v => {
        const rate = v.sent > 0 ? Math.round((v.replied / v.sent) * 100) : 0;
        const isWinner = t.winnerId === v.id;
        return `<div style="padding:4px 0;${isWinner ? "font-weight:700;color:var(--success);" : ""}">
          ${escapeHtml(v.id)}: "${escapeHtml(v.message.slice(0,50))}${v.message.length > 50 ? "..." : ""}" — sent: ${v.sent}, replied: ${v.replied} (${rate}%)${isWinner ? " ✅ WINNER" : ""}
        </div>`;
      }).join("");
      return `<div style="padding:8px 0;border-bottom:1px solid var(--panel-border);">
        <strong>${escapeHtml(t.name)}</strong> <span class="muted">[${escapeHtml(t.status)}]</span>
        ${variants}
      </div>`;
    }).join("");
  } catch (e) { console.error(e); }
}

// ─── Digest Preview ────────────────────────────────────────────────────────
const previewDigestBtn = document.getElementById("previewDigestBtn");
if (previewDigestBtn) {
  previewDigestBtn.addEventListener("click", async () => {
    if (!currentWorkspace) return;
    try {
      const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/automation/digest/preview`);
      const data = await resp.json();
      const pre = document.getElementById("digestPreview");
      if (pre && data.ok) {
        pre.textContent = data.digest;
        pre.style.display = "block";
      }
    } catch (e) { console.error(e); }
  });
}

// ─── Escalation Check ─────────────────────────────────────────────────────
const checkEscalationBtn = document.getElementById("checkEscalationBtn");
if (checkEscalationBtn) {
  checkEscalationBtn.addEventListener("click", async () => {
    if (!currentWorkspace) return;
    try {
      const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/automation/escalation/check`);
      const data = await resp.json();
      const container = document.getElementById("escalationList");
      if (!container || !data.ok) return;
      if (data.leads.length === 0) {
        container.innerHTML = '<span class="muted">✅ No escalations needed right now.</span>';
        return;
      }
      container.innerHTML = data.leads.map(l =>
        `<div style="padding:6px 0;border-bottom:1px solid var(--panel-border);">
          <strong>${escapeHtml(l.name || l.id)}</strong>
          <span class="muted" style="font-size:12px;"> — ${escapeHtml(l.reasons.join(", "))}</span>
        </div>`
      ).join("");
    } catch (e) { console.error(e); }
  });
}

// ─── Routing ───────────────────────────────────────────────────────────────
async function loadRouting() {
  if (!currentWorkspace) return;
  try {
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/automation/routing`);
    const data = await resp.json();
    const container = document.getElementById("routingTable");
    if (!container || !data.ok) return;
    if (data.leads.length === 0) {
      container.innerHTML = '<span class="muted">No leads to route.</span>';
      return;
    }
    const routeColors = { nurture: "#333333", engage: "#555555", close: "#111111", support: "#777777", retain: "#999999", archive: "#bbbbbb", completed: "#444444" };
    container.innerHTML = data.leads.map(l => {
      const color = routeColors[l.route] || "#555555";
      return `<div style="padding:6px 0;border-bottom:1px solid var(--panel-border);display:flex;justify-content:space-between;align-items:center;">
        <span>${escapeHtml(l.name || l.id?.split("@")[0] || "?")}</span>
        <span style="background:${color};color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">${escapeHtml(l.route)}</span>
      </div>`;
    }).join("");
  } catch (e) { console.error(e); }
}

// ─── Tags ──────────────────────────────────────────────────────────────────
async function loadTags() {
  if (!currentWorkspace) return;
  try {
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/automation/tags`);
    const data = await resp.json();
    const container = document.getElementById("tagsTable");
    if (!container || !data.ok) return;
    if (data.leads.length === 0) {
      container.innerHTML = '<span class="muted">No tagged leads.</span>';
      return;
    }
    container.innerHTML = data.leads.map(l => {
      const tags = (l.tags || []).map(t =>
        `<span style="background:var(--accent);color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;">${escapeHtml(t)}</span>`
      ).join(" ");
      return `<div style="padding:6px 0;border-bottom:1px solid var(--panel-border);">
        <strong style="font-size:13px;">${escapeHtml(l.name || l.id?.split("@")[0] || "?")}</strong>
        <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">${tags || '<span class="muted">no tags</span>'}</div>
      </div>`;
    }).join("");
  } catch (e) { console.error(e); }
}

// ─── Objection Tester ──────────────────────────────────────────────────────
const objectionTestForm = document.getElementById("objectionTestForm");
if (objectionTestForm) {
  objectionTestForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentWorkspace) return;
    const message = document.getElementById("objectionInput")?.value?.trim();
    if (!message) return;
    try {
      const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/automation/objection/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await resp.json();
      const container = document.getElementById("objectionResult");
      if (!container) return;
      if (data.rebuttal) {
        container.innerHTML = `<div style="padding:8px;background:var(--success-bg,#f0f0f0);border-radius:var(--radius-sm);">
          <strong>Objection detected:</strong> ${escapeHtml(data.objection)}<br/>
          <strong>Rebuttal:</strong> ${escapeHtml(data.rebuttal)}
        </div>`;
      } else {
        container.innerHTML = `<span class="muted">No objection detected in that message.</span>`;
      }
    } catch (e) { console.error(e); }
  });
}

// ─── Refresh button ────────────────────────────────────────────────────────
const refreshAutomationBtn = document.getElementById("refreshAutomationBtn");
if (refreshAutomationBtn) {
  refreshAutomationBtn.addEventListener("click", loadAutomation);
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── Sales Agent Brain Logic ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

const AGENT_FEATURES = [
  { key: "OUTBOUND_PROSPECTING_ENABLED", label: "Outbound Prospecting", icon: "send",          desc: "Auto-message highest-opportunity leads" },
  { key: "GOAL_PLANNER_ENABLED",         label: "Goal Planner",          icon: "target",        desc: "Self-adjusting weekly targets" },
  { key: "PROMPT_TUNING_ENABLED",        label: "Prompt Self-Tuning",    icon: "sliders",       desc: "Auto-optimise AI persona" },
  { key: "OFFER_AUTHORITY_ENABLED",      label: "Offer Authority",       icon: "badge-percent", desc: "Autonomous discount decisions" },
  { key: "SELF_HEALING_ENABLED",         label: "Self-Healing",          icon: "heart-pulse",   desc: "Auto-fix underperforming flows" },
];

async function loadAgent() {
  if (!currentWorkspace || !authToken) return;
  const wsId = currentWorkspace.id;

  // Load agent config for toggles
  try {
    const resp = await apiFetch(`/api/workspaces/${wsId}/agent/config`);
    const data = await resp.json();
    if (data.ok) renderAgentToggles(data.agent);
  } catch (e) { console.error("Agent config load error:", e); }

  loadGoal();
  loadOutbound();
  loadTuning();
  loadRevenue();
  loadOffers();
  loadHealth();
}

// ─── Agent Feature Toggles ───────────────────────────────────────────────────
function renderAgentToggles(agent) {
  const container = document.getElementById("agentToggles");
  if (!container) return;
  const wsId = currentWorkspace?.id;
  const enabledMap = {
    OUTBOUND_PROSPECTING_ENABLED: agent?.outbound?.enabled,
    GOAL_PLANNER_ENABLED: agent?.goalPlanner?.enabled,
    PROMPT_TUNING_ENABLED: agent?.promptTuning?.enabled,
    OFFER_AUTHORITY_ENABLED: agent?.offerAuth?.enabled,
    SELF_HEALING_ENABLED: agent?.selfHealing?.enabled,
  };
  container.innerHTML = AGENT_FEATURES.map(f => {
    const isEnabled = enabledMap[f.key] || false;
    return `
      <div class="automation-card ${isEnabled ? "enabled" : ""}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <i data-lucide="${f.icon}" style="width:20px;height:20px;flex-shrink:0;"></i>
          <strong style="font-size:14px;">${f.label}</strong>
        </div>
        <p class="muted" style="font-size:12px;margin-bottom:12px;">${f.desc}</p>
        <label class="toggle-switch">
          <input type="checkbox" ${isEnabled ? "checked" : ""} data-config-key="${f.key}" class="agent-toggle" />
          <span class="toggle-slider"></span>
          <span class="toggle-status-label ${isEnabled ? "on" : "off"}">${isEnabled ? "ON" : "OFF"}</span>
        </label>
      </div>
    `;
  }).join("");

  // Single toggle handler
  container.querySelectorAll(".agent-toggle").forEach(cb => {
    cb.addEventListener("change", () => saveAgentToggle(cb));
  });

  // Master On / Off buttons
  const allOnBtn  = document.getElementById("agentAllOnBtn");
  const allOffBtn = document.getElementById("agentAllOffBtn");
  if (allOnBtn)  allOnBtn.onclick = () => setAllAgentToggles(true);
  if (allOffBtn) allOffBtn.onclick = () => setAllAgentToggles(false);

  if (window.lucide) window.lucide.createIcons();
}

async function saveAgentToggle(cb) {
  const wsId = currentWorkspace?.id;
  if (!wsId) return;
  const key = cb.dataset.configKey;
  const val = cb.checked ? "true" : "false";
  const card = cb.closest(".automation-card");
  const statusLabel = card?.querySelector(".toggle-status-label");
  if (statusLabel) {
    statusLabel.textContent = cb.checked ? "ON" : "OFF";
    statusLabel.classList.toggle("on", cb.checked);
    statusLabel.classList.toggle("off", !cb.checked);
  }
  card?.classList.toggle("enabled", cb.checked);
  try {
    const current = await (await apiFetch(`/api/workspaces/${wsId}/config`)).json();
    current[key] = val;
    await apiFetch(`/api/workspaces/${wsId}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(current),
    });
  } catch (e) { console.error("Agent toggle save error:", e); }
}

async function setAllAgentToggles(state) {
  const wsId = currentWorkspace?.id;
  if (!wsId) return;
  // Update all checkboxes in UI
  document.querySelectorAll("#agentToggles .agent-toggle").forEach(cb => {
    cb.checked = state;
    const card = cb.closest(".automation-card");
    const statusLabel = card?.querySelector(".toggle-status-label");
    if (statusLabel) {
      statusLabel.textContent = state ? "ON" : "OFF";
      statusLabel.classList.toggle("on", state);
      statusLabel.classList.toggle("off", !state);
    }
    card?.classList.toggle("enabled", state);
  });
  // Save all to config in one request
  try {
    const current = await (await apiFetch(`/api/workspaces/${wsId}/config`)).json();
    AGENT_FEATURES.forEach(f => { current[f.key] = state ? "true" : "false"; });
    await apiFetch(`/api/workspaces/${wsId}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(current),
    });
  } catch (e) { console.error("Agent master toggle error:", e); }
}

// ─── Goal Planner ─────────────────────────────────────────────────────────────
const goalForm = document.getElementById("goalForm");
if (goalForm) {
  goalForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentWorkspace) return;
    const type = document.getElementById("goalType")?.value || "bookings";
    const target = Number(document.getElementById("goalTarget")?.value || 5);
    try {
      const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/goal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, weeklyTarget: target }),
      });
      const data = await resp.json();
      if (data.ok) {
        alert("Goal set!");
        loadGoal();
      }
    } catch (e) { console.error(e); }
  });
}

async function loadGoal() {
  if (!currentWorkspace) return;
  try {
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/goal`);
    const data = await resp.json();
    const progressEl = document.getElementById("goalProgress");
    const adjEl = document.getElementById("goalAdjustments");
    if (!progressEl || !data.ok) return;
    if (!data.goal) {
      progressEl.innerHTML = '<span class="muted">No goal set. Use the form above to set a weekly target.</span>';
      if (adjEl) adjEl.innerHTML = "";
      return;
    }
    const p = data.progress || data.plan;
    if (!p) return;
    const barColor = p.onTrack ? "var(--primary)" : "var(--danger)";
    progressEl.innerHTML = `
      <div style="margin-bottom:8px;"><strong>${p.emoji || ""} ${p.goalLabel}</strong>: ${p.current} / ${p.weeklyTarget}</div>
      <div style="background:var(--progress-track);border-radius:8px;height:16px;overflow:hidden;">
        <div style="background:${barColor};height:100%;width:${Math.min(100, p.progressPct)}%;border-radius:8px;transition:width 0.3s;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;">
        <span class="muted">${p.progressPct}% complete</span>
        <span class="muted">${p.remaining} to go • ${p.daysLeft} days left</span>
      </div>
    `;
    if (adjEl && p.adjustments && p.adjustments.length > 0) {
      adjEl.innerHTML = '<strong style="font-size:12px;">Auto-adjustments:</strong>' +
        p.adjustments.map(a => `<div style="padding:3px 0;color:var(--muted);"><i data-lucide="zap" style="width:12px;height:12px;vertical-align:middle;"></i> ${escapeHtml(a.detail)}</div>`).join("");
      if (window.lucide) window.lucide.createIcons();
    } else if (adjEl) {
      adjEl.innerHTML = "";
    }
  } catch (e) { console.error(e); }
}

// ─── Outbound Prospecting ────────────────────────────────────────────────────
async function loadOutbound() {
  if (!currentWorkspace) return;
  try {
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/outbound/queue`);
    const data = await resp.json();
    const statsEl = document.getElementById("outboundStats");
    const queueEl = document.getElementById("outboundQueue");
    if (!data.ok) return;
    if (statsEl && data.stats) {
      const s = data.stats;
      statsEl.innerHTML = `
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          <div style="text-align:center;"><div style="font-size:22px;font-weight:700;color:var(--primary);">${s.todaySent}</div><div class="muted" style="font-size:11px;">Sent Today</div></div>
          <div style="text-align:center;"><div style="font-size:22px;font-weight:700;">${s.remaining}</div><div class="muted" style="font-size:11px;">Remaining</div></div>
          <div style="text-align:center;"><div style="font-size:22px;font-weight:700;">${s.weekSent}</div><div class="muted" style="font-size:11px;">This Week</div></div>
        </div>`;
    }
    if (queueEl) {
      if (data.queue.length === 0) {
        queueEl.innerHTML = '<span class="muted">No outbound candidates right now.</span>';
      } else {
        queueEl.innerHTML = '<strong style="font-size:12px;">Next up:</strong>' +
          data.queue.slice(0, 10).map(l => `
            <div style="padding:6px 0;border-bottom:1px solid var(--panel-border);display:flex;justify-content:space-between;align-items:center;">
              <span>${escapeHtml(l.name)}</span>
              <span style="display:flex;gap:6px;align-items:center;">
                <span class="muted" style="font-size:11px;">opp: ${l.oppScore}</span>
                <span style="background:var(--primary);color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;">${escapeHtml(l.status)}</span>
              </span>
            </div>
          `).join("");
      }
    }
  } catch (e) { console.error(e); }
}

// ─── Prompt Tuning ───────────────────────────────────────────────────────────
async function loadTuning() {
  if (!currentWorkspace) return;
  try {
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/tuning`);
    const data = await resp.json();
    const metricsEl = document.getElementById("tuningMetrics");
    const recsEl = document.getElementById("tuningRecommendations");
    if (!data.ok) return;
    const m = data.metrics;
    if (metricsEl && m) {
      metricsEl.innerHTML = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div style="text-align:center;"><div style="font-size:18px;font-weight:700;">${(m.replyRate * 100).toFixed(1)}%</div><div class="muted" style="font-size:11px;">Reply Rate</div></div>
          <div style="text-align:center;"><div style="font-size:18px;font-weight:700;">${m.recentBookings}</div><div class="muted" style="font-size:11px;">Bookings (7d)</div></div>
          <div style="text-align:center;"><div style="font-size:18px;font-weight:700;">${m.recentHotLeads}</div><div class="muted" style="font-size:11px;">Hot Leads (7d)</div></div>
          <div style="text-align:center;"><div style="font-size:18px;font-weight:700;">${m.avgScore}</div><div class="muted" style="font-size:11px;">Avg Score</div></div>
        </div>`;
    }
    if (recsEl && data.recommendations) {
      if (data.recommendations.length === 0) {
        recsEl.innerHTML = '<span class="muted">✅ Performance looks good — no tuning needed.</span>';
      } else {
        recsEl.innerHTML = '<strong style="font-size:12px;">Recommendations:</strong>' +
          data.recommendations.map(r => `<div style="padding:3px 0;color:var(--muted);"><i data-lucide="lightbulb" style="width:12px;height:12px;vertical-align:middle;"></i> ${escapeHtml(r.reason)}</div>`).join("");
        if (window.lucide) window.lucide.createIcons();
      }
    }
  } catch (e) { console.error(e); }
}

const applyTuningBtn = document.getElementById("applyTuningBtn");
if (applyTuningBtn) {
  applyTuningBtn.addEventListener("click", async () => {
    if (!currentWorkspace) return;
    try {
      const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/tuning/apply`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const data = await resp.json();
      if (data.ok) {
        const count = (data.applied || []).length;
        alert(count > 0 ? `Applied ${count} tuning adjustments.` : "No changes needed right now.");
        loadTuning();
      }
    } catch (e) { console.error(e); }
  });
}

// ─── Revenue Attribution ─────────────────────────────────────────────────────
const revenueForm = document.getElementById("revenueForm");
if (revenueForm) {
  revenueForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentWorkspace) return;
    const leadId = document.getElementById("revLeadId")?.value;
    const amount = Number(document.getElementById("revAmount")?.value || 0);
    if (!leadId || amount <= 0) return alert("Select a lead and enter a positive amount.");
    try {
      const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/revenue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, amount }),
      });
      const data = await resp.json();
      if (data.ok) {
        alert("Revenue recorded!");
        document.getElementById("revAmount").value = "";
        loadRevenue();
      } else {
        alert(data.error || "Failed");
      }
    } catch (e) { console.error(e); }
  });
}

async function loadRevenue() {
  if (!currentWorkspace) return;
  // Populate lead select
  const leadSelect = document.getElementById("revLeadId");
  if (leadSelect) {
    const leads = currentWorkspace.leads || [];
    leadSelect.innerHTML = leads
      .filter(l => !l.archived)
      .map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name || l.id?.split("@")[0])}</option>`)
      .join("");
  }
  try {
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/revenue`);
    const data = await resp.json();
    const attrEl = document.getElementById("revenueAttribution");
    const fbEl = document.getElementById("scoringFeedback");
    if (!data.ok) return;
    const a = data.attribution;
    if (attrEl && a) {
      attrEl.innerHTML = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="text-align:center;"><div style="font-size:22px;font-weight:700;color:var(--primary);">${a.currency} ${a.totalRevenue.toLocaleString()}</div><div class="muted" style="font-size:11px;">Total Revenue</div></div>
          <div style="text-align:center;"><div style="font-size:18px;font-weight:700;">${a.conversionRate}%</div><div class="muted" style="font-size:11px;">Conv. Rate</div></div>
          <div style="text-align:center;"><div style="font-size:18px;font-weight:700;">${a.avgDaysToClose}d</div><div class="muted" style="font-size:11px;">Avg Close Time</div></div>
          <div style="text-align:center;"><div style="font-size:18px;font-weight:700;">${a.currency} ${a.avgDealSize.toLocaleString()}</div><div class="muted" style="font-size:11px;">Avg Deal</div></div>
        </div>
        <div class="muted" style="font-size:12px;">ROI: ${a.roi} • ${a.closedWon} closed won / ${a.totalLeads} total leads</div>`;
    }
    const f = data.feedback;
    if (fbEl && f) {
      fbEl.innerHTML = `<div style="padding:8px;background:var(--import-bg);border-radius:var(--radius-sm);margin-top:8px;">
        <strong>Scoring insight:</strong> ${escapeHtml(f.insight)}<br/>
        <span class="muted">Win rate: ${f.winRate}% • Won avg score: ${f.wonAvgScore} • Booking rate among wins: ${f.wonBookingRate}%</span>
        ${f.topConvertingTags.length > 0 ? '<br/><span class="muted">Top converting tags: ' + f.topConvertingTags.map(t => escapeHtml(t.tag)).join(", ") + '</span>' : ''}
      </div>`;
    } else if (fbEl) {
      fbEl.innerHTML = '<span class="muted">Need at least 2 closed-won leads for scoring feedback.</span>';
    }
  } catch (e) { console.error(e); }
}

// ─── Offer Authority ────────────────────────────────────────────────────────
async function loadOffers() {
  if (!currentWorkspace) return;
  try {
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/offers`);
    const data = await resp.json();
    const statsEl = document.getElementById("offerStats");
    const guardEl = document.getElementById("offerGuardrails");
    if (!data.ok) return;
    const s = data.stats;
    if (statsEl && s) {
      statsEl.innerHTML = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div style="text-align:center;"><div style="font-size:18px;font-weight:700;">${s.total}</div><div class="muted" style="font-size:11px;">Offers Made</div></div>
          <div style="text-align:center;"><div style="font-size:18px;font-weight:700;color:var(--primary);">${s.acceptRate}%</div><div class="muted" style="font-size:11px;">Accept Rate</div></div>
          <div style="text-align:center;"><div style="font-size:18px;font-weight:700;">${s.currency} ${s.totalRevenue.toLocaleString()}</div><div class="muted" style="font-size:11px;">Revenue from Offers</div></div>
        </div>
        ${s.bestStrategy ? '<div class="muted" style="font-size:12px;margin-top:8px;">Best strategy: <strong>' + escapeHtml(s.bestStrategy.strategy.replace(/_/g, ' ')) + '</strong> (' + s.bestStrategy.rate + '% accept)</div>' : ''}`;
    }
    const g = data.guardrails;
    if (guardEl && g) {
      guardEl.innerHTML = `<div class="muted" style="margin-top:8px;">Guardrails: max ${g.maxDiscountPct}% off • min score ${g.minLeadScore} • base ${escapeHtml(g.currency)} ${g.basePrice} • max ${g.maxOffersPerLead} per lead${g.allowPaymentPlan ? ' • payment plans allowed' : ''}</div>`;
    }
  } catch (e) { console.error(e); }
}

// ─── Self-Healing ────────────────────────────────────────────────────────────
async function loadHealth() {
  if (!currentWorkspace) return;
  try {
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/health`);
    const data = await resp.json();
    const checksEl = document.getElementById("healthChecks");
    const actionsEl = document.getElementById("healingActions");
    if (!data.ok) return;
    if (checksEl) {
      if (data.checks.length === 0) {
        checksEl.innerHTML = '<span class="muted">Not enough data yet. Features need at least 5-10 messages to generate health metrics.</span>';
      } else {
        checksEl.innerHTML = data.checks.map(c => {
          const icon = c.healthy ? '✅' : '⚠️';
          const color = c.healthy ? 'var(--primary)' : 'var(--danger)';
          return `<div style="padding:6px 0;border-bottom:1px solid var(--panel-border);display:flex;justify-content:space-between;align-items:center;">
            <span>${icon} ${escapeHtml(c.feature.replace(/_/g, ' '))}</span>
            <span style="color:${color};font-weight:600;">${(c.rate * 100).toFixed(1)}% response (${c.conversions}/${c.sent})</span>
          </div>`;
        }).join("");
      }
    }
    if (actionsEl && data.suggestedActions) {
      if (data.suggestedActions.length === 0) {
        actionsEl.innerHTML = "";
      } else {
        actionsEl.innerHTML = '<strong style="font-size:12px;">Suggested fixes:</strong>' +
          data.suggestedActions.map(a => `<div style="padding:3px 0;color:var(--muted);"><i data-lucide="wrench" style="width:12px;height:12px;vertical-align:middle;"></i> ${escapeHtml(a.detail)}</div>`).join("");
        if (window.lucide) window.lucide.createIcons();
      }
    }
  } catch (e) { console.error(e); }
}

const healNowBtn = document.getElementById("healNowBtn");
if (healNowBtn) {
  healNowBtn.addEventListener("click", async () => {
    if (!currentWorkspace) return;
    try {
      const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/health/heal`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const data = await resp.json();
      if (data.ok) {
        alert(data.applied > 0 ? `Applied ${data.applied} healing fixes.` : "All workflows are healthy!");
        loadHealth();
      }
    } catch (e) { console.error(e); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── WhatsApp Alerts & Reports Logic ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

async function loadAlerts() {
  if (!currentWorkspace || !authToken) return;
  const wsId = currentWorkspace.id;

  // Load alert config
  try {
    const resp = await apiFetch(`/api/workspaces/${wsId}/agent/alerts/config`);
    const data = await resp.json();
    if (data.ok) {
      renderAlertConfig(data);
      renderAlertEvents(data.allEvents || [], data.events || []);
    }
  } catch (e) { console.error("Alert config load error:", e); }

  loadAlertHistory();
}

function renderAlertConfig(cfg) {
  const operatorInput   = document.getElementById("alertOperator");
  const intervalInput   = document.getElementById("alertReportInterval");
  const toggle          = document.getElementById("alertEnabledToggle");
  const label           = document.getElementById("alertEnabledLabel");

  if (operatorInput)  operatorInput.value  = cfg.operator || "";
  if (intervalInput)  intervalInput.value  = cfg.reportInterval || 1;
  if (toggle) {
    toggle.checked = cfg.enabled;
    if (label) {
      label.textContent = cfg.enabled ? "ON" : "OFF";
      label.className   = `toggle-status-label ${cfg.enabled ? "on" : "off"}`;
    }
  }
}

function renderAlertEvents(allEvents, enabledEvents) {
  const container = document.getElementById("alertEventsList");
  if (!container) return;
  if (!allEvents || allEvents.length === 0) {
    container.innerHTML = '<span class="muted">No event types available.</span>';
    return;
  }
  container.innerHTML = allEvents.map(ev => {
    const isOn = enabledEvents.includes(ev.key);
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--panel-border);">
        <div style="flex:1;">
          <span style="font-size:16px;margin-right:6px;">${ev.emoji}</span>
          <strong style="font-size:13px;">${ev.label}</strong>
          <p class="muted" style="font-size:11px;margin:2px 0 0 26px;">${ev.description}</p>
        </div>
        <label class="toggle-switch" style="flex-shrink:0;">
          <input type="checkbox" ${isOn ? "checked" : ""} data-event-key="${ev.key}" class="alert-event-toggle" />
          <span class="toggle-slider"></span>
        </label>
      </div>
    `;
  }).join("");
}

async function loadAlertHistory() {
  if (!currentWorkspace) return;
  try {
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/alerts/history`);
    const data = await resp.json();
    const container = document.getElementById("alertHistory");
    if (!container || !data.ok) return;
    if (!data.history || data.history.length === 0) {
      container.innerHTML = '<span class="muted">No alerts sent yet. Configure your operator number and enable alerts to start receiving notifications.</span>';
      return;
    }
    container.innerHTML = data.history.map(h => {
      const time = new Date(h.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      const icon = h.ok ? "✅" : "❌";
      const msg = h.message || h.error || "";
      return `<div style="padding:6px 0;border-bottom:1px solid var(--panel-border);display:flex;justify-content:space-between;align-items:center;">
        <span>${icon} <span class="muted">${time}</span> — ${escapeHtml(msg)}</span>
        <span style="font-size:11px;color:var(--muted);">${escapeHtml(h.kind || '')}</span>
      </div>`;
    }).join("");
  } catch (e) { console.error(e); }
}

// Alert config form submit
const alertConfigForm = document.getElementById("alertConfigForm");
if (alertConfigForm) {
  alertConfigForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentWorkspace) return;
    const operator   = document.getElementById("alertOperator")?.value?.trim() || "";
    const reportInterval = Number(document.getElementById("alertReportInterval")?.value || 1);
    const enabled    = document.getElementById("alertEnabledToggle")?.checked || false;

    // Collect enabled events
    const events = [];
    document.querySelectorAll(".alert-event-toggle").forEach(cb => {
      if (cb.checked) events.push(cb.dataset.eventKey);
    });

    try {
      const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/alerts/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, operator, events, reportInterval }),
      });
      const data = await resp.json();
      if (data.ok) {
        renderAlertConfig(data);
        renderAlertEvents(data.allEvents, data.events);
        alert("Alert settings saved!");
      } else {
        alert(data.error || "Failed to save");
      }
    } catch (e) { console.error(e); alert("Error saving alert config"); }
  });
}

// Alert master toggle instant feedback
const alertEnabledToggle = document.getElementById("alertEnabledToggle");
if (alertEnabledToggle) {
  alertEnabledToggle.addEventListener("change", () => {
    const label = document.getElementById("alertEnabledLabel");
    if (label) {
      label.textContent = alertEnabledToggle.checked ? "ON" : "OFF";
      label.className   = `toggle-status-label ${alertEnabledToggle.checked ? "on" : "off"}`;
    }
  });
}

// Send test alert
const sendTestAlertBtn = document.getElementById("sendTestAlertBtn");
if (sendTestAlertBtn) {
  sendTestAlertBtn.addEventListener("click", async () => {
    if (!currentWorkspace) return;
    sendTestAlertBtn.disabled = true;
    sendTestAlertBtn.textContent = "Sending...";
    try {
      const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/alerts/test`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const data = await resp.json();
      alert(data.ok ? "Test alert sent to your WhatsApp!" : (data.error || "Failed"));
    } catch (e) { alert("Error: " + e.message); }
    sendTestAlertBtn.disabled = false;
    sendTestAlertBtn.innerHTML = '<i data-lucide="bell-ring"></i> Send Test Alert';
    if (window.lucide) window.lucide.createIcons();
  });
}

const refreshAlertsBtn = document.getElementById("refreshAlertsBtn");
if (refreshAlertsBtn) {
  refreshAlertsBtn.addEventListener("click", loadAlerts);
}

// ─── Refresh Agent ───────────────────────────────────────────────────────────
const refreshAgentBtn = document.getElementById("refreshAgentBtn");
if (refreshAgentBtn) {
  refreshAgentBtn.addEventListener("click", loadAgent);
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE CHAT / HUMAN TAKEOVER
// ═══════════════════════════════════════════════════════════════════════════════

let _activeChatContactId = null;
let _chatPollTimer = null;

async function loadLiveChat() {
  if (!currentWorkspace) return;
  await Promise.all([loadTakeoverLeads(), loadActiveTakeovers()]);
}

async function loadTakeoverLeads() {
  if (!currentWorkspace) return;
  const sel = document.getElementById("takeoverLeadSelect");
  if (!sel) return;
  try {
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/takeover/leads`);
    const data = await resp.json();
    if (!data.ok) return;
    sel.innerHTML = '<option value="">(Select a lead)</option>';
    for (const l of data.leads) {
      const opt = document.createElement("option");
      opt.value = l.id;
      opt.textContent = `${l.name} — ${l.status} / ${l.stage}${l.active ? " ✋ ACTIVE" : ""}`;
      sel.appendChild(opt);
    }
  } catch (e) { console.error(e); }
}

async function loadActiveTakeovers() {
  if (!currentWorkspace) return;
  const container = document.getElementById("activeTakeoversList");
  if (!container) return;
  try {
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/takeover`);
    const data = await resp.json();
    if (!data.ok) return;
    if (data.takeovers.length === 0) {
      container.innerHTML = '<span class="muted">No active takeovers. AI is handling all chats.</span>';
      return;
    }
    container.innerHTML = data.takeovers.map(t => {
      const since = new Date(t.since).toLocaleString();
      return `<div class="takeover-card">
        <div class="takeover-info">
          <strong>${escapeHtml(t.name)}</strong>
          <span class="muted" style="font-size:11px;display:block;">${escapeHtml(t.contactId)}</span>
          <span class="muted" style="font-size:11px;">Taken over by ${escapeHtml(t.agent)} · since ${since}</span>
        </div>
        <div class="takeover-actions">
          <button class="btn primary takeover-chat-btn" style="font-size:12px;" data-contact="${escapeHtml(t.contactId)}"><i data-lucide="message-circle"></i> Chat</button>
          <button class="btn takeover-release-btn" style="font-size:12px;background:var(--danger);color:#fff;border:none;" data-contact="${escapeHtml(t.contactId)}"><i data-lucide="log-out"></i> Release</button>
        </div>
      </div>`;
    }).join("");
    container.querySelectorAll(".takeover-chat-btn").forEach(btn => btn.addEventListener("click", () => openLiveChat(btn.dataset.contact)));
    container.querySelectorAll(".takeover-release-btn").forEach(btn => btn.addEventListener("click", () => releaseTakeover(btn.dataset.contact)));
    if (window.lucide) window.lucide.createIcons();
  } catch (e) { console.error(e); }
}

async function startTakeover() {
  if (!currentWorkspace) return;
  const sel = document.getElementById("takeoverLeadSelect");
  const manual = document.getElementById("takeoverManualId");
  const contactId = manual?.value?.trim() || sel?.value;
  if (!contactId) return alert("Select a lead or enter a chat ID.");
  try {
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/takeover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, agentName: "Dashboard Agent" }),
    });
    const data = await resp.json();
    if (data.ok) {
      if (manual) manual.value = "";
      await loadLiveChat();
      openLiveChat(contactId);
    } else {
      alert(data.error || "Failed to take over.");
    }
  } catch (e) { alert("Error: " + e.message); }
}

async function releaseTakeover(contactId) {
  if (!currentWorkspace) return;
  if (!confirm(`Release ${contactId.split("@")[0]} back to AI?`)) return;
  try {
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/takeover`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId }),
    });
    const data = await resp.json();
    if (data.ok) {
      if (_activeChatContactId === contactId) {
        closeLiveChat();
      }
      await loadLiveChat();
    }
  } catch (e) { alert("Error: " + e.message); }
}
// Make available globally for onclick handlers
window.releaseTakeover = releaseTakeover;
window.openLiveChat = openLiveChat;

function openLiveChat(contactId) {
  _activeChatContactId = contactId;
  const section = document.getElementById("liveChatSection");
  if (section) section.style.display = "block";
  refreshChatMessages();
  // Start polling every 3 seconds
  if (_chatPollTimer) clearInterval(_chatPollTimer);
  _chatPollTimer = setInterval(refreshChatMessages, 3000);
}

function closeLiveChat() {
  _activeChatContactId = null;
  const section = document.getElementById("liveChatSection");
  if (section) section.style.display = "none";
  if (_chatPollTimer) { clearInterval(_chatPollTimer); _chatPollTimer = null; }
}

async function refreshChatMessages() {
  if (!currentWorkspace || !_activeChatContactId) return;
  const container = document.getElementById("liveChatMessages");
  const titleEl = document.getElementById("liveChatTitle");
  try {
    const cid = encodeURIComponent(_activeChatContactId);
    const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/takeover/chat/${cid}`);
    const data = await resp.json();
    if (!data.ok) return;
    if (titleEl) titleEl.innerHTML = `<i data-lucide="message-circle" style="width:18px;height:18px;vertical-align:middle;"></i> Chat with ${data.name}`;
    if (container) {
      if (data.messages.length === 0) {
        container.innerHTML = '<span class="muted" style="text-align:center;align-self:center;">No messages yet. Send the first message below.</span>';
      } else {
        container.innerHTML = data.messages.map(m => {
          const time = new Date(m.at).toLocaleTimeString();
          const isOut = m.dir === "out";
          return `<div class="chat-bubble ${isOut ? 'chat-out' : 'chat-in'}">
            <div class="chat-bubble-text">${escapeHtml(m.text)}</div>
            <span class="chat-bubble-time">${time}</span>
          </div>`;
        }).join("");
        container.scrollTop = container.scrollHeight;
      }
    }
    if (window.lucide) window.lucide.createIcons();
  } catch (e) { console.error(e); }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Live chat form submit
const liveChatForm = document.getElementById("liveChatForm");
if (liveChatForm) {
  liveChatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentWorkspace || !_activeChatContactId) return;
    const input = document.getElementById("liveChatInput");
    const message = input?.value?.trim();
    if (!message) return;
    input.value = "";
    try {
      const resp = await apiFetch(`/api/workspaces/${currentWorkspace.id}/agent/takeover/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: _activeChatContactId, message }),
      });
      const data = await resp.json();
      if (!data.ok) alert(data.error || "Send failed");
      refreshChatMessages();
    } catch (e) { alert("Error: " + e.message); }
  });
}

// Takeover button
const takeoverStartBtn = document.getElementById("takeoverStartBtn");
if (takeoverStartBtn) takeoverStartBtn.addEventListener("click", startTakeover);

// Release from chat panel
const liveChatReleaseBtn = document.getElementById("liveChatReleaseBtn");
if (liveChatReleaseBtn) {
  liveChatReleaseBtn.addEventListener("click", () => {
    if (_activeChatContactId) releaseTakeover(_activeChatContactId);
  });
}

// Refresh live chat button
const refreshLivechatBtn = document.getElementById("refreshLivechatBtn");
if (refreshLivechatBtn) refreshLivechatBtn.addEventListener("click", loadLiveChat);

// ═══════════════════════════════════════════════════════════════════════════
// BILLING & PLANS
// ═══════════════════════════════════════════════════════════════════════════

let _allPlans = [];

async function loadBilling() {
  if (!activeWorkspaceId) return;
  try {
    // Fetch plan list + workspace billing in parallel
    const [plansRes, billingRes] = await Promise.all([
      fetch("/api/plans"),
      fetch(`/api/workspaces/${activeWorkspaceId}/billing`, { headers: authHeaders() }),
    ]);
    const plansData = await plansRes.json();
    const billingData = await billingRes.json();

    _allPlans = plansData.plans || [];
    const plan = billingData.subscription || billingData.plan || {};
    const planInfo = billingData.plan || {};
    const usage = billingData.usage || {};
    const features = billingData.features || {};
    const cycleResetAt = billingData.cycleResetAt;

    // Current Plan Header
    const nameEl = document.getElementById("billingPlanName");
    const badgeEl = document.getElementById("billingPlanBadge");
    const priceEl = document.getElementById("billingPrice");
    const cycleEl = document.getElementById("billingCycleReset");

    if (nameEl) nameEl.textContent = planInfo.name || "Free";
    if (badgeEl) {
      const status = plan.status || "active";
      badgeEl.textContent = status;
      badgeEl.className = "status-badge " + (status === "active" ? "badge-green" : status === "trial" ? "badge-yellow" : "badge-red");
    }
    if (priceEl) priceEl.textContent = `$${planInfo.price || 0}`;
    if (cycleEl) cycleEl.textContent = cycleResetAt ? new Date(cycleResetAt).toLocaleDateString() : "—";

    // Trial / Cancel buttons
    const trialBtn = document.getElementById("startTrialBtn");
    const cancelBtn = document.getElementById("cancelPlanBtn");
    if (trialBtn) trialBtn.style.display = (planInfo.id === "free" && plan.status !== "trial") ? "" : "none";
    if (cancelBtn) cancelBtn.style.display = (planInfo.id !== "free") ? "" : "none";

    // Usage meters
    renderUsageMeters(usage);

    // Plan cards
    renderPlanCards(_allPlans, planInfo);

    // Feature comparison table
    renderFeatureTable(_allPlans);
  } catch (e) {
    console.error("Billing load error:", e);
  }
}

function renderUsageMeters(usage) {
  const container = document.getElementById("billingUsageMeters");
  if (!container) return;

  const meters = [
    { key: "messagesSent", icon: "send" },
    { key: "aiCalls",      icon: "brain" },
    { key: "leads",        icon: "users" },
    { key: "members",      icon: "user-plus" },
    { key: "scheduledMessages", icon: "calendar" },
  ];

  container.innerHTML = meters.map(m => {
    const entry = usage[m.key];
    if (!entry) return "";
    const used = entry.used || 0;
    const limit = entry.limit;
    const label = entry.label || m.key;
    const max = limit === -1 ? "∞" : (limit || 0);
    const pct = limit === -1 ? 5 : (limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0);
    const color = pct >= 90 ? "var(--danger)" : pct >= 70 ? "var(--warning, orange)" : "var(--primary)";
    return `
      <div class="usage-meter-card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <i data-lucide="${m.icon}" style="width:16px;height:16px;"></i>
          <span style="font-weight:600;">${label}</span>
        </div>
        <div class="usage-bar-track">
          <div class="usage-bar-fill" style="width:${pct}%;background:${color};"></div>
        </div>
        <div class="muted" style="font-size:12px;margin-top:4px;">${used.toLocaleString()} / ${max === "∞" ? "∞" : Number(max).toLocaleString()}</div>
      </div>
    `;
  }).join("");

  lucide.createIcons();
}

function renderPlanCards(plans, currentPlan) {
  const container = document.getElementById("billingPlanCards");
  if (!container) return;

  container.innerHTML = plans.map(p => {
    const isCurrent = p.id === currentPlan.id;
    const featureList = Object.entries(p.features || {}).filter(([, v]) => v).map(([k]) => k).slice(0, 8);
    return `
      <div class="plan-card ${isCurrent ? 'plan-card-active' : ''}">
        <div style="margin-bottom:12px;">
          <div style="font-size:18px;font-weight:700;">${escapeHtml(p.name)}</div>
          <div style="font-size:28px;font-weight:800;margin:8px 0;">$${p.price}<span style="font-size:14px;font-weight:400;color:var(--muted-ink);">/mo</span></div>
        </div>
        <div style="font-size:12px;margin-bottom:12px;">
          <div>📨 ${p.limits.messagesPerMonth === -1 ? 'Unlimited' : p.limits.messagesPerMonth.toLocaleString()} messages</div>
          <div>🧠 ${p.limits.aiCallsPerMonth === -1 ? 'Unlimited' : p.limits.aiCallsPerMonth.toLocaleString()} AI calls</div>
          <div>👥 ${p.limits.leadsMax === -1 ? 'Unlimited' : p.limits.leadsMax.toLocaleString()} leads</div>
          <div>📅 ${p.limits.scheduledMessages === -1 ? 'Unlimited' : p.limits.scheduledMessages} scheduled msgs</div>
          <div>👤 ${p.limits.membersPerWorkspace === -1 ? 'Unlimited' : p.limits.membersPerWorkspace} team members</div>
        </div>
        <div style="font-size:11px;color:var(--muted-ink);margin-bottom:12px;">
          ${featureList.map(f => `✓ ${f.replace(/([A-Z])/g, ' $1').trim()}`).join('<br>')}
          ${Object.values(p.features).filter(v => v).length > 8 ? '<br>+ more...' : ''}
        </div>
        ${isCurrent
          ? '<button class="btn" disabled style="width:100%;opacity:0.6;">Current Plan</button>'
          : `<button class="btn primary" style="width:100%;" onclick="upgradePlan('${escapeHtml(p.id)}')">
               ${p.price > (plans.find(x => x.id === currentPlan.id)?.price || 0) ? 'Upgrade' : 'Switch'} to ${escapeHtml(p.name)}
             </button>`
        }
      </div>
    `;
  }).join("");

  lucide.createIcons();
}

function renderFeatureTable(plans) {
  const table = document.getElementById("billingFeatureTable");
  if (!table) return;

  // Collect all feature keys
  const allFeatures = [...new Set(plans.flatMap(p => Object.keys(p.features || {})))];

  let html = `<thead><tr>
    <th style="text-align:left;padding:8px;border-bottom:1px solid var(--panel-border);">Feature</th>
    ${plans.map(p => `<th style="text-align:center;padding:8px;border-bottom:1px solid var(--panel-border);">${p.name}</th>`).join("")}
  </tr></thead><tbody>`;

  allFeatures.forEach(f => {
    const label = f.replace(/([A-Z])/g, " $1").trim();
    html += `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid var(--panel-border);text-transform:capitalize;">${label}</td>
      ${plans.map(p => {
        const has = p.features?.[f];
        return `<td style="text-align:center;padding:6px 8px;border-bottom:1px solid var(--panel-border);">${has ? '✅' : '—'}</td>`;
      }).join("")}
    </tr>`;
  });

  html += "</tbody>";
  table.innerHTML = html;
}

async function upgradePlan(planId) {
  if (!activeWorkspaceId) return;
  if (!confirm(`Switch to the "${planId}" plan? In production, this would redirect to a payment page.`)) return;
  try {
    const resp = await fetch(`/api/workspaces/${activeWorkspaceId}/billing/plan`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });
    const data = await resp.json();
    if (!data.ok) return alert(data.error || "Failed to change plan");
    alert(`✅ Plan changed to ${planId}!`);
    loadBilling();
  } catch (e) {
    alert("Error: " + e.message);
  }
}

// Start Trial
const startTrialBtn = document.getElementById("startTrialBtn");
if (startTrialBtn) {
  startTrialBtn.addEventListener("click", async () => {
    if (!activeWorkspaceId) return;
    try {
      const resp = await fetch(`/api/workspaces/${activeWorkspaceId}/billing/trial`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await resp.json();
      if (!data.ok) return alert(data.error || "Failed to start trial");
      alert("🎉 Free trial started! Enjoy Pro features for 14 days.");
      loadBilling();
    } catch (e) {
      alert("Error: " + e.message);
    }
  });
}

// Cancel Plan
const cancelPlanBtn = document.getElementById("cancelPlanBtn");
if (cancelPlanBtn) {
  cancelPlanBtn.addEventListener("click", async () => {
    if (!activeWorkspaceId) return;
    if (!confirm("Are you sure you want to cancel your plan? You'll be downgraded to Free.")) return;
    try {
      const resp = await fetch(`/api/workspaces/${activeWorkspaceId}/billing/cancel`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await resp.json();
      if (!data.ok) return alert(data.error || "Failed to cancel");
      alert("Plan cancelled. You are now on the Free plan.");
      loadBilling();
    } catch (e) {
      alert("Error: " + e.message);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPER ADMIN PANEL
// ═══════════════════════════════════════════════════════════════════════════

async function loadAdminPanel() {
  try {
    const [overviewRes, usersRes, plansRes] = await Promise.all([
      fetch("/api/workspaces/admin/billing/overview", { headers: authHeaders() }),
      fetch("/api/workspaces/admin/users", { headers: authHeaders() }),
      fetch("/api/plans"),
    ]);
    const overview = await overviewRes.json();
    const usersData = await usersRes.json();
    const plansData = await plansRes.json();

    if (!overview.ok) { console.error("Admin overview:", overview.error); return; }

    renderAdminKpis(overview);
    renderAdminWorkspaces(overview.workspaces || [], plansData.plans || []);
    renderAdminUsers(usersData.users || [], plansData.plans || []);
  } catch (e) {
    console.error("Admin panel load error:", e);
  }
}

function renderAdminKpis(data) {
  const container = document.getElementById("adminKpis");
  if (!container) return;

  const kpis = [
    { label: "Total Workspaces", value: data.totalWorkspaces || 0, icon: "building", color: "var(--primary)" },
    { label: "Total Users", value: data.totalUsers || 0, icon: "users", color: "var(--accent)" },
    { label: "Monthly Revenue", value: `$${(data.monthlyRevenue || 0).toLocaleString()}`, icon: "dollar-sign", color: "#111111" },
    { label: "Currency", value: data.currency || "USD", icon: "banknote", color: "var(--muted)" },
  ];

  container.innerHTML = kpis.map(k => `
    <div class="admin-kpi-card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div style="width:36px;height:36px;border-radius:var(--radius-sm);background:${k.color}15;display:flex;align-items:center;justify-content:center;">
          <i data-lucide="${k.icon}" style="width:18px;height:18px;color:${k.color};"></i>
        </div>
        <span class="muted" style="font-size:12px;">${k.label}</span>
      </div>
      <div style="font-size:24px;font-weight:800;">${k.value}</div>
    </div>
  `).join("");
  lucide.createIcons();
}

function renderAdminWorkspaces(workspaces, plans) {
  const table = document.getElementById("adminWorkspacesTable");
  if (!table) return;

  let html = `<thead><tr>
    <th>Workspace</th>
    <th>Members</th>
    <th>Created</th>
  </tr></thead><tbody>`;

  workspaces.forEach(ws => {
    html += `<tr>
      <td><strong>${escapeHtml(ws.name)}</strong><br><span class="muted" style="font-size:11px;">${ws.id}</span></td>
      <td>${ws.members}</td>
      <td style="font-size:11px;">${new Date(ws.createdAt).toLocaleDateString()}</td>
    </tr>`;
  });

  html += "</tbody>";
  table.innerHTML = html;
}

function renderAdminUsers(users, plans) {
  const table = document.getElementById("adminUsersTable");
  if (!table) return;

  const planOptions = (plans || []).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} ($${p.price})</option>`).join("");

  let html = `<thead><tr>
    <th>Username</th><th>User ID</th><th>Plan</th><th>Status</th><th>Workspaces</th><th>Created</th><th>Actions</th>
  </tr></thead><tbody>`;

  users.forEach(u => {
    const wsList = (u.workspaces || []).map(w => `${escapeHtml(w.name)} (${w.role})`).join(", ") || "—";
    const statusClass = u.planStatus === "active" ? "badge-green" : u.planStatus === "trialing" ? "badge-yellow" : "badge-red";
    html += `<tr>
      <td><strong>${escapeHtml(u.username)}</strong></td>
      <td class="muted" style="font-size:11px;">${escapeHtml(u.id)}</td>
      <td>${escapeHtml(u.planName || 'Free')}</td>
      <td><span class="status-badge ${statusClass}">${escapeHtml(u.planStatus || 'active')}</span></td>
      <td style="font-size:12px;">${wsList}</td>
      <td style="font-size:11px;">${new Date(u.createdAt).toLocaleDateString()}</td>
      <td style="white-space:nowrap;">
        <select id="adminUserPlan_${escapeHtml(u.id)}" style="font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid var(--panel-border);background:var(--input-bg);color:var(--ink);">
          ${planOptions}
        </select>
        <button class="btn admin-set-plan-btn" data-uid="${escapeHtml(u.id)}" style="font-size:11px;padding:2px 8px;">Set</button>
        <button class="btn admin-reset-btn" data-uid="${escapeHtml(u.id)}" style="font-size:11px;padding:2px 8px;background:var(--accent);color:#fff;border:none;">Reset</button>
        <button class="btn admin-del-btn" data-uid="${escapeHtml(u.id)}" data-uname="${escapeHtml(u.username)}" style="font-size:11px;padding:2px 8px;background:var(--danger);color:#fff;border:none;">Delete</button>
      </td>
    </tr>`;
  });

  html += "</tbody>";
  table.innerHTML = html;

  // Set current plan in dropdowns
  users.forEach(u => {
    const sel = document.getElementById(`adminUserPlan_${u.id}`);
    if (sel) sel.value = u.plan || 'free';
  });

  // Wire admin action buttons
  table.querySelectorAll(".admin-set-plan-btn").forEach(btn => btn.addEventListener("click", () => adminChangeUserPlan(btn.dataset.uid)));
  table.querySelectorAll(".admin-reset-btn").forEach(btn => btn.addEventListener("click", () => adminResetUserUsage(btn.dataset.uid)));
  table.querySelectorAll(".admin-del-btn").forEach(btn => btn.addEventListener("click", () => adminDeleteUser(btn.dataset.uid, btn.dataset.uname)));
}

async function adminChangeUserPlan(userId) {
  const sel = document.getElementById(`adminUserPlan_${userId}`);
  if (!sel) return;
  const planId = sel.value;
  if (!confirm(`Set user ${userId} to plan "${planId}"?`)) return;
  try {
    const resp = await fetch(`/api/workspaces/admin/users/${userId}/plan`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });
    const data = await resp.json();
    if (!data.ok) return alert(data.error || "Failed");
    alert(`✅ ${data.message}`);
    loadAdminPanel();
  } catch (e) { alert("Error: " + e.message); }
}

async function adminResetUserUsage(userId) {
  if (!confirm(`Reset all usage counters for user ${userId}?`)) return;
  try {
    const resp = await fetch(`/api/workspaces/admin/users/${userId}/reset-usage`, {
      method: "POST",
      headers: authHeaders(),
    });
    const data = await resp.json();
    if (!data.ok) return alert(data.error || "Failed");
    alert(`✅ ${data.message}`);
    loadAdminPanel();
  } catch (e) { alert("Error: " + e.message); }
}

async function adminDeleteUser(userId, username) {
  if (!confirm(`⚠️ Delete user "${username}"? This cannot be undone.`)) return;
  try {
    const resp = await fetch(`/api/workspaces/admin/users/${userId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    const data = await resp.json();
    if (!data.ok) return alert(data.error || "Failed");
    alert(`✅ User "${data.removed}" deleted.`);
    loadAdminPanel();
  } catch (e) { alert("Error: " + e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKUP & DATA SAFETY PANEL
// ═══════════════════════════════════════════════════════════════════════════

async function loadBackupPanel() {
  try {
    const [statusRes, listRes] = await Promise.all([
      fetch("/api/workspaces/admin/backups/status", { headers: authHeaders() }),
      fetch("/api/workspaces/admin/backups", { headers: authHeaders() }),
    ]);
    const statusData = await statusRes.json();
    const listData = await listRes.json();

    if (!statusData.ok) { console.error("Backup status:", statusData.error); return; }

    renderBackupStatus(statusData);
    renderBackupList(listData.backups || []);
  } catch (e) {
    console.error("Backup panel load error:", e);
  }
}

function renderBackupStatus(data) {
  const container = document.getElementById("backupStatusCards");
  if (!container) return;

  const cards = [
    { label: "Total Backups", value: data.totalBackups || 0, icon: "archive", color: "var(--primary)" },
    { label: "Backup Size", value: `${data.totalBackupSizeMB || 0} MB`, icon: "hard-drive", color: "var(--accent)" },
    { label: "Main File", value: `${data.mainFileSizeMB || 0} MB`, icon: "file-json", color: "#111111" },
    { label: "Max Kept", value: data.maxBackups || 50, icon: "layers", color: "#555555" },
    { label: "Auto Interval", value: `${data.backupIntervalMinutes || 60} min`, icon: "timer", color: "#999999" },
    { label: "Saves Since Boot", value: data.savesSinceStart || 0, icon: "save", color: "var(--muted)" },
  ];

  container.innerHTML = cards.map(k => `
    <div class="admin-kpi-card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <div style="width:32px;height:32px;border-radius:var(--radius-sm);background:${k.color}15;display:flex;align-items:center;justify-content:center;">
          <i data-lucide="${k.icon}" style="width:16px;height:16px;color:${k.color};"></i>
        </div>
        <span class="muted" style="font-size:11px;">${k.label}</span>
      </div>
      <div style="font-size:20px;font-weight:800;">${k.value}</div>
    </div>
  `).join("");

  // Last backup info
  if (data.lastBackupAt) {
    container.innerHTML += `
      <div class="admin-kpi-card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <div style="width:32px;height:32px;border-radius:var(--radius-sm);background:rgba(0,0,0,0.04);display:flex;align-items:center;justify-content:center;">
            <i data-lucide="clock" style="width:16px;height:16px;color:#555;"></i>
          </div>
          <span class="muted" style="font-size:11px;">Last Backup</span>
        </div>
        <div style="font-size:13px;font-weight:600;">${new Date(data.lastBackupAt).toLocaleString()}</div>
      </div>
    `;
  }

  lucide.createIcons();
}

function renderBackupList(backups) {
  const table = document.getElementById("backupListTable");
  if (!table) return;

  if (backups.length === 0) {
    table.innerHTML = '<tr><td class="muted" style="padding:20px;text-align:center;">No backups yet. Click "Create Backup Now" to make one.</td></tr>';
    return;
  }

  let html = `<thead><tr>
    <th>Filename</th><th>Size</th><th>Created</th><th style="text-align:right;">Actions</th>
  </tr></thead><tbody>`;

  backups.forEach(b => {
    const sizeMB = (b.sizeBytes / 1024 / 1024).toFixed(2);
    const label = b.filename.includes("_manual") ? "🔵 Manual" :
                  b.filename.includes("_startup") ? "🟢 Startup" :
                  b.filename.includes("_pre-restore") ? "🟠 Pre-Restore" :
                  b.filename.includes("_scheduled") ? "⏱️ Scheduled" : "📦 Auto";
    html += `<tr>
      <td>
        <span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--panel-border);margin-right:6px;">${label}</span>
        <span style="font-size:12px;font-family:monospace;">${escapeHtml(b.filename)}</span>
      </td>
      <td style="font-size:12px;">${sizeMB} MB</td>
      <td style="font-size:12px;">${new Date(b.createdAt).toLocaleString()}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn" style="font-size:11px;padding:2px 8px;" onclick="adminDownloadBackup('${escapeHtml(b.filename)}')">
          <i data-lucide="download" style="width:12px;height:12px;"></i> Download
        </button>
        <button class="btn" style="font-size:11px;padding:2px 8px;background:#333;color:#fff;border:none;" onclick="adminRestoreBackup('${escapeHtml(b.filename)}')">
          <i data-lucide="undo-2" style="width:12px;height:12px;"></i> Restore
        </button>
        <button class="btn" style="font-size:11px;padding:2px 8px;background:var(--danger);color:#fff;border:none;" onclick="adminDeleteBackup('${escapeHtml(b.filename)}')">
          <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
        </button>
      </td>
    </tr>`;
  });

  html += "</tbody>";
  table.innerHTML = html;
  lucide.createIcons();
}

async function adminCreateBackup() {
  try {
    const resp = await fetch("/api/workspaces/admin/backups/create", {
      method: "POST",
      headers: authHeaders(),
    });
    const data = await resp.json();
    if (!data.ok) return alert(data.error || "Backup failed");
    alert("✅ " + data.message);
    loadBackupPanel();
  } catch (e) { alert("Error: " + e.message); }
}

async function adminRestoreBackup(filename) {
  if (!confirm(`⚠️ RESTORE from backup "${filename}"?\n\nThis will:\n• Save a pre-restore backup first\n• Replace ALL current data (users, workspaces, leads, etc.)\n• Take effect immediately\n\nAre you sure?`)) return;
  if (!confirm("This is your LAST chance. Current data will be overwritten. Continue?")) return;
  try {
    const resp = await fetch("/api/workspaces/admin/backups/restore", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
    const data = await resp.json();
    if (!data.ok) return alert(data.error || "Restore failed");
    alert("✅ " + data.message);
    loadAdminPanel();
    loadBackupPanel();
  } catch (e) { alert("Error: " + e.message); }
}

async function adminDeleteBackup(filename) {
  if (!confirm(`Delete backup "${filename}"?`)) return;
  try {
    const resp = await fetch(`/api/workspaces/admin/backups/${encodeURIComponent(filename)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    const data = await resp.json();
    if (!data.ok) return alert(data.error || "Delete failed");
    loadBackupPanel();
  } catch (e) { alert("Error: " + e.message); }
}

function adminDownloadBackup(filename) {
  const a = document.createElement("a");
  a.href = `/api/workspaces/admin/backups/download/${encodeURIComponent(filename)}`;
  a.download = filename;
  // Need auth header — use fetch instead
  fetch(a.href, { headers: authHeaders() })
    .then(r => r.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    })
    .catch(e => alert("Download failed: " + e.message));
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── Campaign Builder, History, Templates ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// --- Campaign History ---
async function loadCampaignHistory() {
  if (!activeWorkspaceId) return;
  const tbody = document.getElementById("campaignHistoryBody");
  const empty = document.getElementById("campaignHistoryEmpty");
  if (!tbody) return;
  try {
    const data = await getJson(workspacePath("/campaigns"));
    const list = data.campaigns || [];
    tbody.innerHTML = "";
    if (list.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";
    for (const c of list) {
      const statusColors = {
        draft: "var(--muted)", scheduled: "var(--accent)", sending: "var(--primary)",
        completed: "var(--primary)", cancelled: "var(--danger)"
      };
      const color = statusColors[c.status] || "var(--muted)";
      const audienceLabel = c.audience?.type === "segment" ? "Segment" : c.audience?.type === "specific" ? "Specific" : "All";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="font-weight:600;">${escapeHtml(c.name)}</td>
        <td><span class="badge" style="color:${color};border-color:${color};">${escapeHtml(c.status)}</span></td>
        <td class="muted">${escapeHtml(audienceLabel)}</td>
        <td style="color:var(--primary);">${c.stats?.delivered || 0}</td>
        <td style="color:var(--danger);">${c.stats?.failed || 0}</td>
        <td style="color:var(--accent);">${c.stats?.replied || 0}</td>
        <td class="muted" style="font-size:12px;">${c.sentAt ? new Date(c.sentAt).toLocaleString() : "—"}</td>
        <td style="white-space: nowrap;">
          ${c.status === "draft" ? `<button class="btn send-camp-btn" data-id="${c.id}" style="padding:3px 8px;font-size:11px;color:var(--primary);border-color:var(--primary);">🚀 Send</button>` : ""}
          ${c.status === "sending" ? `<button class="btn cancel-camp-btn" data-id="${c.id}" style="padding:3px 8px;font-size:11px;color:var(--danger);border-color:var(--danger);">Cancel</button>` : ""}
          <button class="btn clone-camp-btn" data-id="${c.id}" style="padding:3px 8px;font-size:11px;">Clone</button>
          ${c.status === "draft" || c.status === "completed" || c.status === "cancelled" ? `<button class="btn del-camp-btn" data-id="${c.id}" style="padding:3px 8px;font-size:11px;color:var(--danger);border-color:var(--danger);">✕</button>` : ""}
        </td>
      `;
      tbody.appendChild(tr);
    }
    // Wire send buttons
    tbody.querySelectorAll(".send-camp-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Send this campaign now?")) return;
        try {
          const data = await getJson(workspacePath(`/campaigns/${btn.dataset.id}/send`), {
            method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: "{}"
          });
          showToast(`Campaign sending to ${data.recipientCount} recipients`, "success");
          loadCampaignHistory();
        } catch (e) { showToast(e.message, "error"); }
      });
    });
    // Wire cancel buttons
    tbody.querySelectorAll(".cancel-camp-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await getJson(workspacePath(`/campaigns/${btn.dataset.id}/cancel`), {
            method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: "{}"
          });
          showToast("Campaign cancelled", "success");
          loadCampaignHistory();
        } catch (e) { showToast(e.message, "error"); }
      });
    });
    // Wire clone buttons
    tbody.querySelectorAll(".clone-camp-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await getJson(workspacePath(`/campaigns/${btn.dataset.id}/clone`), {
            method: "POST", headers: authHeaders()
          });
          showToast("Campaign cloned", "success");
          loadCampaignHistory();
        } catch (e) { showToast(e.message, "error"); }
      });
    });
    // Wire delete buttons
    tbody.querySelectorAll(".del-camp-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this campaign?")) return;
        try {
          await getJson(workspacePath(`/campaigns/${btn.dataset.id}`), {
            method: "DELETE", headers: authHeaders()
          });
          showToast("Campaign deleted", "success");
          loadCampaignHistory();
        } catch (e) { showToast(e.message, "error"); }
      });
    });
  } catch (err) {
    console.warn("Failed to load campaign history:", err.message);
  }
}

// --- Template Library ---
async function loadTemplateLibrary() {
  if (!activeWorkspaceId) return;
  const tbody = document.getElementById("templateLibraryBody");
  const empty = document.getElementById("templateLibraryEmpty");
  if (!tbody) return;
  try {
    const data = await getJson(workspacePath("/templates"));
    const list = data.templates || [];
    tbody.innerHTML = "";
    if (list.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";
    for (const t of list) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="font-weight:600;">${escapeHtml(t.name)}</td>
        <td class="muted">${escapeHtml(t.category || 'general')}</td>
        <td class="muted" style="max-width:260px;"><div class="reason-cell">${escapeHtml((t.messages || []).join(' | '))}</div></td>
        <td class="muted" style="font-size:12px;">${new Date(t.createdAt).toLocaleString()}</td>
        <td style="white-space: nowrap;">
          <button class="btn use-tpl-btn" data-id="${t.id}" style="padding:3px 8px;font-size:11px;color:var(--primary);border-color:var(--primary);">Use</button>
          <button class="btn del-tpl-btn" data-id="${t.id}" style="padding:3px 8px;font-size:11px;color:var(--danger);border-color:var(--danger);">✕</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
    // Wire use buttons → populate campaign builder
    tbody.querySelectorAll(".use-tpl-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const tplData = await getJson(workspacePath(`/templates`));
          const tpl = (tplData.templates || []).find(t => t.id === btn.dataset.id);
          if (!tpl) return showToast("Template not found", "error");
          const campMsgA = document.getElementById("campMessageA");
          const campMsgB = document.getElementById("campMessageB");
          const campNameInput = document.getElementById("campName");
          if (campMsgA && tpl.messages[0]) campMsgA.value = tpl.messages[0];
          if (campMsgB && tpl.messages[1]) campMsgB.value = tpl.messages[1];
          if (campNameInput) campNameInput.value = `From: ${tpl.name}`;
          showToast("Template loaded into builder", "success");
        } catch (e) { showToast(e.message, "error"); }
      });
    });
    // Wire delete buttons
    tbody.querySelectorAll(".del-tpl-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this template?")) return;
        try {
          await getJson(workspacePath(`/templates/${btn.dataset.id}`), {
            method: "DELETE", headers: authHeaders()
          });
          showToast("Template deleted", "success");
          loadTemplateLibrary();
          populateCampTemplateSelect();
        } catch (e) { showToast(e.message, "error"); }
      });
    });
  } catch (err) {
    console.warn("Failed to load templates:", err.message);
  }
}

// --- Populate campaign media select ---
async function populateCampMediaSelect() {
  if (!activeWorkspaceId) return;
  const sel = document.getElementById("campMediaSelect");
  if (!sel) return;
  try {
    const data = await getJson(workspacePath("/media"));
    sel.innerHTML = '<option value="">(none)</option>';
    for (const m of (data.media || [])) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.filename} (${m.mimeType})`;
      sel.appendChild(opt);
    }
  } catch (_) {}
}

// --- Populate campaign template select ---
async function populateCampTemplateSelect() {
  if (!activeWorkspaceId) return;
  const sel = document.getElementById("campTemplateSelect");
  if (!sel) return;
  try {
    const data = await getJson(workspacePath("/templates"));
    sel.innerHTML = '<option value="">(start from scratch)</option>';
    for (const t of (data.templates || [])) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    }
  } catch (_) {}
}

// --- Campaign template select handler ---
(function() {
  const sel = document.getElementById("campTemplateSelect");
  if (sel) {
    sel.addEventListener("change", async () => {
      const tplId = sel.value;
      if (!tplId) return;
      try {
        const data = await getJson(workspacePath("/templates"));
        const tpl = (data.templates || []).find(t => t.id === tplId);
        if (!tpl) return;
        const campMsgA = document.getElementById("campMessageA");
        const campMsgB = document.getElementById("campMessageB");
        if (campMsgA && tpl.messages[0]) campMsgA.value = tpl.messages[0];
        if (campMsgB && tpl.messages[1]) campMsgB.value = tpl.messages[1];
      } catch (_) {}
    });
  }
})();

// --- Audience preview ---
(function() {
  const btn = document.getElementById("previewAudienceBtn");
  if (btn) {
    btn.addEventListener("click", async () => {
      try {
        const audience = buildAudienceFromForm();
        const data = await getJson(workspacePath("/campaigns/audience-preview"), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ audience })
        });
        const countEl = document.getElementById("audiencePreviewCount");
        if (countEl) countEl.textContent = `${data.count} recipient${data.count !== 1 ? "s" : ""} matched`;
      } catch (e) { showToast(e.message, "error"); }
    });
  }
})();

function buildAudienceFromForm() {
  const type = document.getElementById("campAudienceType")?.value || "all";
  if (type === "all") return { type: "all" };
  if (type === "specific") {
    const numbersRaw = document.getElementById("campSpecificNumbers")?.value || "";
    const recipients = numbersRaw.split(/[\n,]/).map(n => n.trim().replace(/[^0-9]/g, "")).filter(Boolean);
    return { type: "specific", recipients };
  }
  const statusSel = document.getElementById("campFilterStatus");
  const stageSel = document.getElementById("campFilterStage");
  const statuses = statusSel ? Array.from(statusSel.selectedOptions).map(o => o.value) : [];
  const stages = stageSel ? Array.from(stageSel.selectedOptions).map(o => o.value) : [];
  const tagsRaw = document.getElementById("campFilterTags")?.value || "";
  const tags = tagsRaw.split(",").map(t => t.trim()).filter(Boolean);
  const scoreMin = Number(document.getElementById("campScoreMin")?.value) || 0;
  const scoreMax = Number(document.getElementById("campScoreMax")?.value) || 100;
  return { type: "segment", filters: { statuses, stages, tags, scoreMin, scoreMax } };
}

// --- Campaign builder form submit ---
(function() {
  const form = document.getElementById("campaignBuilderForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const name = document.getElementById("campName")?.value || "";
        const msgA = document.getElementById("campMessageA")?.value || "";
        const msgB = document.getElementById("campMessageB")?.value || "";
        const messages = [msgA, msgB].filter(Boolean);
        if (messages.length === 0) return showToast("At least one message is required", "error");

        const audience = buildAudienceFromForm();
        const mediaId = document.getElementById("campMediaSelect")?.value || "";
        const mode = document.getElementById("campSendMode")?.value || "instant";
        const abTestEnabled = document.getElementById("campAbTestToggle")?.checked || false;

        const payload = { name, messages, audience, mediaId, mode, abTestEnabled };
        const data = await getJson(workspacePath("/campaigns"), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        showToast(`Campaign "${data.campaign.name}" saved as draft`, "success");
        form.reset();
        loadCampaignHistory();
      } catch (e) { showToast(e.message, "error"); }
    });
  }
})();

// --- Save as template button ---
(function() {
  const btn = document.getElementById("saveCampAsTemplateBtn");
  if (btn) {
    btn.addEventListener("click", async () => {
      try {
        const name = document.getElementById("campName")?.value || "Untitled Template";
        const msgA = document.getElementById("campMessageA")?.value || "";
        const msgB = document.getElementById("campMessageB")?.value || "";
        const messages = [msgA, msgB].filter(Boolean);
        if (messages.length === 0) return showToast("Add at least one message first", "error");

        const data = await getJson(workspacePath("/templates"), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ name, messages, category: "campaign" })
        });
        showToast(`Template "${data.template.name}" saved`, "success");
        loadTemplateLibrary();
        populateCampTemplateSelect();
      } catch (e) { showToast(e.message, "error"); }
    });
  }
})();

// --- Refresh buttons ---
(function() {
  const btn1 = document.getElementById("refreshCampaignsBtn");
  if (btn1) btn1.addEventListener("click", loadCampaignHistory);
  const btn2 = document.getElementById("refreshTemplatesBtn");
  if (btn2) btn2.addEventListener("click", () => { loadTemplateLibrary(); populateCampTemplateSelect(); });
})();

// ═══════════════════════════════════════════════════════════════════════════
// ─── Auto-Reply Settings (on Campaigns page) ──────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

function loadAutoReplySettings() {
  if (!activeWorkspaceId) return;
  getJson(workspacePath("/config")).then(config => {
    const el = (id) => document.getElementById(id);
    if (el("arEnabled")) el("arEnabled").value = config.AUTO_REPLY_ENABLED || "true";
    if (el("arMode")) el("arMode").value = config.AUTO_REPLY_MODE || "exact";
    if (el("arTrigger")) el("arTrigger").value = config.AUTO_REPLY_TRIGGER || "";
    if (el("arText")) el("arText").value = config.AUTO_REPLY_TEXT || "";
    if (el("arRules")) el("arRules").value = config.AUTO_REPLY_RULES || "";
  }).catch(_ => {});
}

(function() {
  const saveBtn = document.getElementById("saveAutoReplyBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const resultEl = document.getElementById("autoReplySaveResult");
      try {
        // Load current config, merge auto-reply fields, save back
        const config = await getJson(workspacePath("/config"));
        config.AUTO_REPLY_ENABLED = document.getElementById("arEnabled")?.value || "true";
        config.AUTO_REPLY_MODE = document.getElementById("arMode")?.value || "exact";
        config.AUTO_REPLY_TRIGGER = document.getElementById("arTrigger")?.value || "";
        config.AUTO_REPLY_TEXT = document.getElementById("arText")?.value || "";
        config.AUTO_REPLY_RULES = document.getElementById("arRules")?.value || "";

        await getJson(workspacePath("/config"), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(config)
        });
        showToast("Auto-reply settings saved", "success");
        if (resultEl) resultEl.textContent = "✅ Saved!";
        setTimeout(() => { if (resultEl) resultEl.textContent = ""; }, 3000);
      } catch (e) {
        showToast(e.message, "error");
        if (resultEl) resultEl.textContent = "❌ " + e.message;
      }
    });
  }
})();

// ═══════════════════════════════════════════════════════════════════════════
// ─── Campaign Builder: Audience type toggle for specific numbers ──────────
// ═══════════════════════════════════════════════════════════════════════════

(function() {
  const typeSelect = document.getElementById("campAudienceType");
  const numberWrap = document.getElementById("campSpecificNumbersWrap");
  if (typeSelect && numberWrap) {
    typeSelect.addEventListener("change", () => {
      numberWrap.style.display = typeSelect.value === "specific" ? "block" : "none";
    });
  }
})();

// ─── Instant campaign: import recipients from Excel/CSV ───────────────────

(function() {
  const importBtn = document.getElementById("instantImportRecipientsBtn");
  const fileInput = document.getElementById("instantRecipientsFile");
  const resultEl = document.getElementById("instantImportResult");
  const recipientsEl = document.getElementById("instantRecipients");
  if (importBtn && fileInput && recipientsEl) {
    importBtn.addEventListener("click", async () => {
      if (!fileInput.files?.length) {
        if (resultEl) resultEl.textContent = "Select a file first.";
        return;
      }
      try {
        const formData = new FormData();
        formData.set("file", fileInput.files[0]);
        formData.set("mode", "append");
        const res = await fetch(workspacePath("/recipients/import"), {
          method: "POST",
          headers: { "Authorization": `Bearer ${authToken}` },
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error || "Import failed.");
        // Append imported numbers to the textarea
        const existing = (recipientsEl.value || "").trim();
        const imported = data.recipients || [];
        recipientsEl.value = existing ? existing + "\n" + imported.join("\n") : imported.join("\n");
        if (resultEl) resultEl.textContent = `✅ ${data.importedCount || imported.length} numbers imported`;
        fileInput.value = "";
      } catch (err) {
        if (resultEl) resultEl.textContent = "❌ " + err.message;
      }
    });
  }
})();

// ═══════════════════════════════════════════════════════════════════════════
// ─── Tools View (Blacklist, Webhooks, Flows, Custom Fields, Audit, Branding)
// ═══════════════════════════════════════════════════════════════════════════

function loadToolsView() {
  loadBlacklist();
  loadWebhooks();
  loadFlows();
  loadCustomFields();
  loadAuditLog();
  loadBranding();
}

// ── Lead CSV Export ──
async function exportLeadsCsv() {
  if (!activeWorkspaceId) return;
  try {
    const res = await fetch(workspacePath("/leads/export"), { headers: authHeaders() });
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads_${activeWorkspaceId}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("CSV exported", "success");
  } catch (e) { showToast(e.message, "error"); }
}

// ── Lead CSV Import ──
function showImportLeadsModal() {
  const m = document.getElementById("importLeadsModal");
  if (m) { m.style.display = "flex"; document.getElementById("importResult").textContent = ""; }
}

async function importLeadsCsv() {
  const raw = document.getElementById("importCsvText")?.value || "";
  if (!raw.trim()) return showToast("Paste CSV data first", "error");
  try {
    const lines = raw.trim().split("\n").map(l => l.split(",").map(c => c.trim()));
    const headers = lines[0].map(h => h.toLowerCase());
    const leads = [];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i];
      const lead = {};
      headers.forEach((h, idx) => { lead[h] = row[idx] || ""; });
      leads.push(lead);
    }
    const data = await getJson(workspacePath("/leads/import"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ leads })
    });
    document.getElementById("importResult").textContent = `✅ Imported: ${data.imported}, Updated: ${data.updated}, Total: ${data.total}`;
    showToast(`Imported ${data.imported} new leads`, "success");
    loadLeads();
  } catch (e) {
    document.getElementById("importResult").textContent = "❌ " + e.message;
    showToast(e.message, "error");
  }
}

// ── Lead Detail Modal ──
async function openLeadDetail(lead) {
  const modal = document.getElementById("leadDetailModal");
  const title = document.getElementById("leadDetailTitle");
  const content = document.getElementById("leadDetailContent");
  if (!modal || !content) return;
  title.textContent = lead.name || lead.id;
  modal.style.display = "flex";

  // Load notes and custom fields
  let notes = [];
  let customFields = [];
  try {
    const [notesRes, fieldsRes] = await Promise.all([
      getJson(workspacePath(`/leads/${encodeURIComponent(lead.id)}/notes`)),
      getJson(workspacePath("/custom-fields"))
    ]);
    notes = notesRes.notes || [];
    customFields = fieldsRes.fields || [];
  } catch {}

  const q = lead.qualification || {};
  content.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div><b style="font-size:11px;">Status:</b> <span class="badge status-${escapeHtml(lead.status || 'cold')}">${escapeHtml(lead.status || 'cold')}</span></div>
      <div><b style="font-size:11px;">Stage:</b> <span class="badge">${escapeHtml(lead.stage || 'new')}</span></div>
      <div><b style="font-size:11px;">Score:</b> ${lead.score || 0}</div>
      <div><b style="font-size:11px;">Language:</b> ${escapeHtml(lead.language || '-')}</div>
      <div><b style="font-size:11px;">Assigned:</b> ${escapeHtml(lead.assignedTo || '') || '<i class="muted">unassigned</i>'}</div>
      <div><b style="font-size:11px;">Tags:</b> ${escapeHtml((lead.tags || []).join(', ')) || '-'}</div>
      <div><b style="font-size:11px;">Need:</b> ${escapeHtml(q.need || '-')}</div>
      <div><b style="font-size:11px;">Budget:</b> ${escapeHtml(q.budget || '-')}</div>
      <div><b style="font-size:11px;">Timeline:</b> ${escapeHtml(q.timeline || '-')}</div>
      <div><b style="font-size:11px;">Decision Maker:</b> ${escapeHtml(q.decision_maker || '-')}</div>
      <div><b style="font-size:11px;">Objection:</b> ${escapeHtml(lead.primaryObjection || '-')}</div>
      <div><b style="font-size:11px;">Follow-ups:</b> ${lead.followUpCount || 0}</div>
    </div>

    <!-- Assignment -->
    <div style="margin-bottom:16px;">
      <b style="font-size:12px;">Assign To:</b>
      <div style="display:flex;gap:8px;margin-top:4px;">
        <input id="assignInput" type="text" value="${escapeHtml(lead.assignedTo || '')}" placeholder="Username or team member" style="flex:1;padding:4px 8px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);" />
        <button class="btn primary" onclick="assignLead('${escapeHtml(lead.id)}')" style="font-size:11px;">Assign</button>
      </div>
    </div>

    <!-- Tags -->
    <div style="margin-bottom:16px;">
      <b style="font-size:12px;">Tags:</b>
      <div style="display:flex;gap:8px;margin-top:4px;">
        <input id="tagsInput" type="text" value="${escapeHtml((lead.tags || []).join(', '))}" placeholder="tag1, tag2, tag3" style="flex:1;padding:4px 8px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);" />
        <button class="btn primary" onclick="updateLeadTags('${escapeHtml(lead.id)}')" style="font-size:11px;">Save Tags</button>
      </div>
    </div>

    <!-- Custom Fields -->
    ${customFields.length > 0 ? `
      <div style="margin-bottom:16px;">
        <b style="font-size:12px;">Custom Fields:</b>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
          ${customFields.map(f => `
            <div>
              <label style="font-size:11px;">${escapeHtml(f.name)}</label>
              <input class="cf-input" data-key="${escapeHtml(f.key)}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}" value="${escapeHtml((lead.customData || {})[f.key] || '')}" style="width:100%;padding:4px;font-size:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);" />
            </div>
          `).join("")}
        </div>
        <button class="btn primary" onclick="saveLeadCustomData('${escapeHtml(lead.id)}')" style="font-size:11px;margin-top:8px;">Save Custom Fields</button>
      </div>
    ` : ''}

    <!-- Notes -->
    <div>
      <b style="font-size:12px;">Internal Notes (${notes.length}):</b>
      <div style="display:flex;gap:8px;margin:8px 0;">
        <input id="noteInput" type="text" placeholder="Add a note..." style="flex:1;padding:4px 8px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);" />
        <button class="btn primary" onclick="addLeadNote('${escapeHtml(lead.id)}')" style="font-size:11px;">Add</button>
      </div>
      <div id="notesList" style="max-height:200px;overflow-y:auto;">
        ${notes.map(n => `
          <div style="padding:8px;border-bottom:1px solid var(--border);font-size:12px;">
            <div>${escapeHtml(n.text)}</div>
            <div class="muted" style="font-size:10px;margin-top:4px;">${escapeHtml(n.author)} — ${new Date(n.createdAt).toLocaleString()}</div>
          </div>
        `).join("") || '<div class="muted" style="font-size:12px;padding:8px;">No notes yet.</div>'}
      </div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}

async function assignLead(leadId) {
  try {
    const assignedTo = document.getElementById("assignInput")?.value || "";
    await getJson(workspacePath(`/leads/${encodeURIComponent(leadId)}/assign`), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ assignedTo })
    });
    showToast("Lead assigned", "success");
    loadLeads();
  } catch (e) { showToast(e.message, "error"); }
}

async function updateLeadTags(leadId) {
  try {
    const tags = (document.getElementById("tagsInput")?.value || "").split(",").map(t => t.trim()).filter(Boolean);
    await getJson(workspacePath(`/leads/${encodeURIComponent(leadId)}/tags`), {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ tags })
    });
    showToast("Tags updated", "success");
    loadLeads();
  } catch (e) { showToast(e.message, "error"); }
}

async function saveLeadCustomData(leadId) {
  try {
    const inputs = document.querySelectorAll(".cf-input");
    const customData = {};
    inputs.forEach(inp => { customData[inp.dataset.key] = inp.value; });
    await getJson(workspacePath(`/leads/${encodeURIComponent(leadId)}/custom-data`), {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(customData)
    });
    showToast("Custom fields saved", "success");
  } catch (e) { showToast(e.message, "error"); }
}

async function addLeadNote(leadId) {
  try {
    const text = document.getElementById("noteInput")?.value || "";
    if (!text) return;
    await getJson(workspacePath(`/leads/${encodeURIComponent(leadId)}/notes`), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    showToast("Note added", "success");
    // Reload detail
    const result = await getJson(workspacePath("/leads"));
    const lead = (result.leads || []).find(l => l.id === leadId);
    if (lead) openLeadDetail(lead);
  } catch (e) { showToast(e.message, "error"); }
}

// ── Duplicates ──
async function findDuplicateLeads() {
  try {
    const data = await getJson(workspacePath("/leads/duplicates"));
    const modal = document.getElementById("dedupModal");
    const content = document.getElementById("dedupContent");
    if (!modal || !content) return;
    modal.style.display = "flex";
    if (data.groups.length === 0) {
      content.innerHTML = '<p class="muted">No duplicate leads found. 🎉</p>';
      return;
    }
    content.innerHTML = data.groups.map(g => `
      <div style="padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;">
        <div style="font-weight:600;font-size:13px;">Primary: ${escapeHtml(g.primaryId)}</div>
        <div class="muted" style="font-size:11px;">Duplicates: ${g.duplicates.map(d => escapeHtml(d.id)).join(", ")}</div>
        <button class="btn primary" data-primary="${escapeHtml(g.primaryId)}" data-dups='${JSON.stringify(g.duplicates.map(d => d.id)).replace(/'/g, "&#39;")}' onclick="mergeDups(this.dataset.primary, JSON.parse(this.dataset.dups))" style="font-size:11px;margin-top:6px;">Merge</button>
      </div>
    `).join("");
  } catch (e) { showToast(e.message, "error"); }
}

async function mergeDups(primaryId, dupIds) {
  try {
    await getJson(workspacePath("/leads/merge"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ primaryId, duplicateIds: dupIds })
    });
    showToast("Leads merged", "success");
    findDuplicateLeads();
    loadLeads();
  } catch (e) { showToast(e.message, "error"); }
}

async function autoMergeAllDups() {
  try {
    const data = await getJson(workspacePath("/leads/auto-merge"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" }
    });
    showToast(`Auto-merged ${data.totalMerged || 0} duplicates`, "success");
    document.getElementById("dedupModal").style.display = "none";
    loadLeads();
  } catch (e) { showToast(e.message, "error"); }
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Blacklist / DND ──
// ═══════════════════════════════════════════════════════════════════════════
async function loadBlacklist() {
  if (!activeWorkspaceId) return;
  try {
    const data = await getJson(workspacePath("/blacklist"));
    const list = data.blacklist || [];
    document.getElementById("blacklistCount").textContent = `${list.length} blocked number${list.length !== 1 ? "s" : ""}`;
    const el = document.getElementById("blacklistList");
    if (!el) return;
    if (list.length === 0) { el.innerHTML = '<span class="muted">No blocked numbers.</span>'; return; }
    el.innerHTML = list.map(b => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);">
        <span>${escapeHtml(b.number)} <span class="muted">(${escapeHtml(b.reason || 'manual')})</span></span>
        <button class="btn bl-remove-btn" data-number="${escapeHtml(b.number)}" style="font-size:10px;padding:2px 6px;color:var(--danger);">Remove</button>
      </div>
    `).join("");
    el.querySelectorAll(".bl-remove-btn").forEach(btn => btn.addEventListener("click", () => removeFromBlacklist(btn.dataset.number)));
  } catch (e) { showToast(e.message, "error"); }
}

async function addToBlacklist() {
  const numbers = document.getElementById("blacklistInput")?.value || "";
  if (!numbers.trim()) return showToast("Enter numbers to block", "error");
  try {
    await getJson(workspacePath("/blacklist"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ numbers, reason: "manual" })
    });
    document.getElementById("blacklistInput").value = "";
    showToast("Numbers added to blacklist", "success");
    loadBlacklist();
  } catch (e) { showToast(e.message, "error"); }
}

async function removeFromBlacklist(number) {
  try {
    await getJson(workspacePath("/blacklist"), {
      method: "DELETE",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ numbers: [number] })
    });
    showToast("Removed from blacklist", "success");
    loadBlacklist();
  } catch (e) { showToast(e.message, "error"); }
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Webhooks ──
// ═══════════════════════════════════════════════════════════════════════════
let _webhookEvents = [];

async function loadWebhooks() {
  if (!activeWorkspaceId) return;
  try {
    const data = await getJson(workspacePath("/webhooks"));
    _webhookEvents = data.availableEvents || [];
    const list = data.webhooks || [];
    const el = document.getElementById("webhookList");
    if (!el) return;
    if (list.length === 0) { el.innerHTML = '<span class="muted">No webhooks configured.</span>'; return; }
    el.innerHTML = list.map(w => `
      <div style="padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;">
        <div style="font-weight:600;word-break:break-all;">${escapeHtml(w.url)}</div>
        <div class="muted" style="font-size:10px;">Events: ${escapeHtml((w.events || []).join(', '))} | Fired: ${w.firedCount || 0} | Fails: ${w.failCount || 0}</div>
        <div style="margin-top:4px;display:flex;gap:6px;">
          <button class="btn wh-test-btn" data-wh-id="${escapeHtml(w.id)}" style="font-size:10px;padding:2px 6px;">Test</button>
          <button class="btn wh-del-btn" data-wh-id="${escapeHtml(w.id)}" style="font-size:10px;padding:2px 6px;color:var(--danger);">Delete</button>
        </div>
      </div>
    `).join("");
    el.querySelectorAll(".wh-test-btn").forEach(btn => btn.addEventListener("click", () => testWebhook(btn.dataset.whId)));
    el.querySelectorAll(".wh-del-btn").forEach(btn => btn.addEventListener("click", () => deleteWebhook(btn.dataset.whId)));
  } catch (e) { showToast(e.message, "error"); }
}

function showAddWebhookForm() {
  const form = document.getElementById("webhookForm");
  form.style.display = "block";
  const checkboxes = document.getElementById("webhookEventsCheckboxes");
  if (_webhookEvents.length === 0) {
    // Load events first
    getJson(workspacePath("/webhooks")).then(d => {
      _webhookEvents = d.availableEvents || [];
      renderWebhookEventCheckboxes();
    });
  } else {
    renderWebhookEventCheckboxes();
  }
}

function renderWebhookEventCheckboxes() {
  const el = document.getElementById("webhookEventsCheckboxes");
  if (!el) return;
  el.innerHTML = _webhookEvents.map(evt => `
    <label style="display:flex;align-items:center;gap:3px;"><input type="checkbox" class="wh-evt-cb" value="${evt}" checked />${evt}</label>
  `).join("");
}

async function saveWebhook() {
  try {
    const url = document.getElementById("webhookUrl")?.value || "";
    const secret = document.getElementById("webhookSecret")?.value || "";
    const events = Array.from(document.querySelectorAll(".wh-evt-cb:checked")).map(cb => cb.value);
    if (!url) return showToast("URL is required", "error");
    await getJson(workspacePath("/webhooks"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ url, events, secret })
    });
    document.getElementById("webhookForm").style.display = "none";
    showToast("Webhook created", "success");
    loadWebhooks();
  } catch (e) { showToast(e.message, "error"); }
}

async function testWebhook(id) {
  try {
    await getJson(workspacePath(`/webhooks/${id}/test`), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" }
    });
    showToast("Test event fired", "success");
  } catch (e) { showToast(e.message, "error"); }
}

async function deleteWebhook(id) {
  if (!confirm("Delete this webhook?")) return;
  try {
    await getJson(workspacePath(`/webhooks/${id}`), {
      method: "DELETE",
      headers: authHeaders()
    });
    showToast("Webhook deleted", "success");
    loadWebhooks();
  } catch (e) { showToast(e.message, "error"); }
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Chatbot Flows ──
// ═══════════════════════════════════════════════════════════════════════════
async function loadFlows() {
  if (!activeWorkspaceId) return;
  try {
    const data = await getJson(workspacePath("/flows"));
    const list = data.flows || [];
    const el = document.getElementById("flowList");
    if (!el) return;
    if (list.length === 0) { el.innerHTML = '<span class="muted">No chatbot flows. Create one to auto-respond before AI.</span>'; return; }
    el.innerHTML = list.map(f => `
      <div style="padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;">
        <div style="font-weight:600;">${escapeHtml(f.name)} <span class="badge" style="font-size:10px;">${f.enabled ? 'Active' : 'Disabled'}</span></div>
        <div class="muted" style="font-size:10px;">Trigger: "${escapeHtml(f.trigger)}" (${escapeHtml(f.triggerMode)}) | Steps: ${(f.steps || []).length}</div>
        <div style="margin-top:4px;display:flex;gap:6px;">
          <button class="btn flow-del-btn" data-flow-id="${escapeHtml(f.id)}" style="font-size:10px;padding:2px 6px;color:var(--danger);">Delete</button>
        </div>
      </div>
    `).join("");
    el.querySelectorAll(".flow-del-btn").forEach(btn => btn.addEventListener("click", () => deleteFlow(btn.dataset.flowId)));
  } catch (e) { showToast(e.message, "error"); }
}

function showAddFlowForm() {
  document.getElementById("flowForm").style.display = "block";
}

async function saveFlow() {
  try {
    const name = document.getElementById("flowName")?.value || "";
    const trigger = document.getElementById("flowTrigger")?.value || "";
    const triggerMode = document.getElementById("flowTriggerMode")?.value || "contains";
    const replyMsg = document.getElementById("flowReply")?.value || "";
    if (!name || !trigger || !replyMsg) return showToast("Fill in all fields", "error");
    await getJson(workspacePath("/flows"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        name, trigger, triggerMode,
        steps: [{ id: "step_1", type: "reply", message: replyMsg }]
      })
    });
    document.getElementById("flowForm").style.display = "none";
    showToast("Flow created", "success");
    loadFlows();
  } catch (e) { showToast(e.message, "error"); }
}

async function deleteFlow(id) {
  if (!confirm("Delete this flow?")) return;
  try {
    await getJson(workspacePath(`/flows/${id}`), { method: "DELETE", headers: authHeaders() });
    showToast("Flow deleted", "success");
    loadFlows();
  } catch (e) { showToast(e.message, "error"); }
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Custom Lead Fields ──
// ═══════════════════════════════════════════════════════════════════════════
async function loadCustomFields() {
  if (!activeWorkspaceId) return;
  try {
    const data = await getJson(workspacePath("/custom-fields"));
    const fields = data.fields || [];
    const el = document.getElementById("customFieldList");
    if (!el) return;
    if (fields.length === 0) { el.innerHTML = '<span class="muted">No custom fields. Add fields to track extra lead data.</span>'; return; }
    el.innerHTML = fields.map(f => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);">
        <span><b>${escapeHtml(f.name)}</b> <span class="muted">(${escapeHtml(f.type)})</span> ${f.options?.length ? '→ ' + escapeHtml(f.options.join(', ')) : ''}</span>
        <button class="btn cf-del-btn" data-cf-id="${escapeHtml(f.id)}" style="font-size:10px;padding:2px 6px;color:var(--danger);">Delete</button>
      </div>
    `).join("");
    el.querySelectorAll(".cf-del-btn").forEach(btn => btn.addEventListener("click", () => deleteCustomField(btn.dataset.cfId)));
  } catch (e) { showToast(e.message, "error"); }
}

function showAddFieldForm() {
  const formEl = document.getElementById("customFieldForm");
  if (formEl) formEl.style.display = "block";
  const typeSelect = document.getElementById("cfType");
  const optWrap = document.getElementById("cfOptionsWrap");
  if (typeSelect && optWrap) {
    // Remove old listener before adding new one (prevent leak)
    const handler = () => {
      optWrap.style.display = typeSelect.value === "select" ? "block" : "none";
    };
    typeSelect.onchange = handler;
  }
}

async function saveCustomField() {
  try {
    const name = document.getElementById("cfName")?.value || "";
    const type = document.getElementById("cfType")?.value || "text";
    const options = type === "select" ? (document.getElementById("cfOptions")?.value || "").split(",").map(o => o.trim()).filter(Boolean) : [];
    if (!name) return showToast("Field name required", "error");
    await getJson(workspacePath("/custom-fields"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, options })
    });
    document.getElementById("customFieldForm").style.display = "none";
    showToast("Custom field created", "success");
    loadCustomFields();
  } catch (e) { showToast(e.message, "error"); }
}

async function deleteCustomField(id) {
  if (!confirm("Delete this custom field?")) return;
  try {
    await getJson(workspacePath(`/custom-fields/${id}`), { method: "DELETE", headers: authHeaders() });
    showToast("Field deleted", "success");
    loadCustomFields();
  } catch (e) { showToast(e.message, "error"); }
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Audit Log ──
// ═══════════════════════════════════════════════════════════════════════════
async function loadAuditLog() {
  if (!activeWorkspaceId) return;
  const actionFilter = document.getElementById("auditActionFilter")?.value || "";
  try {
    const data = await getJson(workspacePath(`/audit-log?action=${actionFilter}&limit=100`));
    const entries = data.entries || [];
    const body = document.getElementById("auditLogBody");
    if (!body) return;
    if (entries.length === 0) { body.innerHTML = '<tr><td colspan="4" class="muted" style="text-align:center;padding:16px;">No audit entries.</td></tr>'; return; }
    body.innerHTML = entries.map(e => `
      <tr>
        <td class="muted" style="white-space:nowrap;">${new Date(e.timestamp).toLocaleString()}</td>
        <td>${escapeHtml(e.userId || '-')}</td>
        <td><span class="badge">${escapeHtml(e.action)}</span></td>
        <td style="max-width:300px;word-break:break-word;font-size:11px;">${escapeHtml(JSON.stringify(e.details || {}))}</td>
      </tr>
    `).join("");

    // Populate action filter dropdown
    const actionsRes = await getJson(workspacePath("/audit-log/actions"));
    const select = document.getElementById("auditActionFilter");
    if (select && actionsRes.actions) {
      const current = select.value;
      select.innerHTML = '<option value="">All Actions</option>' + actionsRes.actions.map(a => `<option value="${escapeHtml(a)}" ${a === current ? 'selected' : ''}>${escapeHtml(a)}</option>`).join("");
    }
  } catch (e) { showToast(e.message, "error"); }
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Branding / White-Label ──
// ═══════════════════════════════════════════════════════════════════════════
async function loadBranding() {
  if (!activeWorkspaceId) return;
  try {
    const data = await getJson(workspacePath("/branding"));
    const b = data.branding || {};
    const el = (id) => document.getElementById(id);
    if (el("brandingAppName")) el("brandingAppName").value = b.appName || "";
    if (el("brandingLogoUrl")) el("brandingLogoUrl").value = b.logoUrl || "";
    if (el("brandingPrimaryColor")) el("brandingPrimaryColor").value = b.primaryColor || "#111111";
    if (el("brandingAccentColor")) el("brandingAccentColor").value = b.accentColor || "#555555";
    if (el("brandingSupportEmail")) el("brandingSupportEmail").value = b.supportEmail || "";
    if (el("brandingFooterText")) el("brandingFooterText").value = b.footerText || "";
  } catch {}
}

async function saveBranding() {
  try {
    await getJson(workspacePath("/branding"), {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        appName: document.getElementById("brandingAppName")?.value || "",
        logoUrl: document.getElementById("brandingLogoUrl")?.value || "",
        primaryColor: document.getElementById("brandingPrimaryColor")?.value || "",
        accentColor: document.getElementById("brandingAccentColor")?.value || "",
        supportEmail: document.getElementById("brandingSupportEmail")?.value || "",
        footerText: document.getElementById("brandingFooterText")?.value || "",
      })
    });
    showToast("Branding saved", "success");
  } catch (e) { showToast(e.message, "error"); }
}

async function resetBranding() {
  if (!confirm("Reset branding to defaults?")) return;
  try {
    await getJson(workspacePath("/branding/reset"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" }
    });
    showToast("Branding reset", "success");
    loadBranding();
  } catch (e) { showToast(e.message, "error"); }
}

// ═══════════════════════════════════════════════════════════════════════════
// KNOWLEDGE BASE (RAG)
// ═══════════════════════════════════════════════════════════════════════════

async function loadKnowledgeBase() {
  if (!activeWorkspaceId) return;
  try {
    const data = await getJson(workspacePath("/knowledge-base"));
    const docs = data.documents || [];
    const stats = data.stats || {};

    // Stats
    const el = (id) => document.getElementById(id);
    if (el("kbDocCount")) el("kbDocCount").textContent = stats.documentCount || 0;
    if (el("kbChunkCount")) el("kbChunkCount").textContent = stats.totalChunks || 0;
    if (el("kbCharCount")) el("kbCharCount").textContent = (stats.totalChars || 0).toLocaleString();
    if (el("kbTotalSize")) el("kbTotalSize").textContent = `${stats.totalSizeMB || "0"} MB`;

    // Document list
    const listEl = el("kbDocumentList");
    if (listEl) {
      if (docs.length === 0) {
        listEl.innerHTML = '<span class="muted">No documents uploaded yet. Upload your first document above.</span>';
      } else {
        listEl.innerHTML = docs.map(doc => {
          const sizeKB = ((doc.sizeBytes || 0) / 1024).toFixed(1);
          const uploaded = new Date(doc.uploadedAt).toLocaleString();
          const iconMap = {
            "application/pdf": "file-text",
            "text/plain": "file-type",
            "text/markdown": "file-code",
            "text/csv": "file-spreadsheet",
          };
          const icon = iconMap[doc.mimeType] || "file";
          return `<div class="kb-doc-card">
            <div class="kb-doc-info">
              <div class="kb-doc-icon"><i data-lucide="${icon}" style="width:20px;height:20px;"></i></div>
              <div class="kb-doc-details">
                <div class="kb-doc-name">${escapeHtml(doc.filename)}</div>
                <div class="kb-doc-meta">${sizeKB} KB · ${doc.chunkCount} chunks · ${(doc.charCount || 0).toLocaleString()} chars · ${uploaded}</div>
              </div>
            </div>
            <button class="btn" onclick="deleteKbDocument('${escapeHtml(doc.id)}')" style="font-size:11px;padding:4px 10px;color:var(--danger);border-color:var(--danger);">
              <i data-lucide="trash-2" style="width:12px;height:12px;"></i> Delete
            </button>
          </div>`;
        }).join("");
      }
    }
    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    showToast("Failed to load knowledge base: " + e.message, "error");
  }
}

// Upload document
const kbUploadForm = document.getElementById("kbUploadForm");
if (kbUploadForm) {
  kbUploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeWorkspaceId) return;
    const fileInput = document.getElementById("kbFileInput");
    const resultEl = document.getElementById("kbUploadResult");
    if (!fileInput?.files?.length) {
      showToast("Select a file to upload", "error");
      return;
    }
    try {
      if (resultEl) resultEl.textContent = "Uploading & processing...";
      const formData = new FormData();
      formData.set("file", fileInput.files[0]);
      const resp = await fetch(workspacePath("/knowledge-base"), {
        method: "POST",
        headers: { "Authorization": `Bearer ${authToken}` },
        body: formData,
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "Upload failed");
      if (resultEl) resultEl.textContent = `✅ "${data.document.filename}" — ${data.chunkCount} chunks, ${data.charCount.toLocaleString()} characters`;
      fileInput.value = "";
      showToast("Document uploaded successfully", "success");
      loadKnowledgeBase();
    } catch (err) {
      if (resultEl) resultEl.textContent = "❌ " + err.message;
      showToast(err.message, "error");
    }
  });
}

// Search KB
const kbSearchBtn = document.getElementById("kbSearchBtn");
if (kbSearchBtn) {
  kbSearchBtn.addEventListener("click", async () => {
    if (!activeWorkspaceId) return;
    const query = document.getElementById("kbSearchInput")?.value?.trim();
    if (!query) return showToast("Enter a search query", "error");
    const resultEl = document.getElementById("kbSearchResult");
    try {
      const data = await getJson(workspacePath(`/knowledge-base/search?q=${encodeURIComponent(query)}`));
      if (resultEl) {
        resultEl.style.display = "block";
        resultEl.textContent = data.hasContext
          ? data.context
          : "(No relevant context found for this query)";
      }
    } catch (e) {
      if (resultEl) { resultEl.style.display = "block"; resultEl.textContent = "❌ " + e.message; }
    }
  });
}

// Also search on Enter key
const kbSearchInput = document.getElementById("kbSearchInput");
if (kbSearchInput) {
  kbSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); kbSearchBtn?.click(); }
  });
}

async function deleteKbDocument(docId) {
  if (!activeWorkspaceId) return;
  if (!confirm("Delete this document from the knowledge base?")) return;
  try {
    const data = await getJson(workspacePath(`/knowledge-base/${docId}`), {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (data.ok === false) throw new Error(data.error);
    showToast(`Document "${data.removed}" deleted`, "success");
    loadKnowledgeBase();
  } catch (e) {
    showToast(e.message, "error");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATION ANALYTICS (Enhanced)
// ═══════════════════════════════════════════════════════════════════════════

async function loadConversationAnalytics() {
  if (!activeWorkspaceId) return;
  try {
    const fromEl = document.getElementById("reportFrom");
    const toEl = document.getElementById("reportTo");
    let qs = "";
    if (fromEl?.value) qs += `from=${encodeURIComponent(new Date(fromEl.value).toISOString())}&`;
    if (toEl?.value) qs += `to=${encodeURIComponent(new Date(toEl.value).toISOString())}&`;

    const data = await getJson(workspacePath(`/conversation-analytics?${qs}`));

    // Response Times
    const rt = data.responseTimes || {};
    const el = (id) => document.getElementById(id);
    if (el("caAvgResponse")) el("caAvgResponse").textContent = formatSeconds(rt.avg);
    if (el("caMedianResponse")) el("caMedianResponse").textContent = formatSeconds(rt.median);
    if (el("caP95Response")) el("caP95Response").textContent = formatSeconds(rt.p95);
    if (el("caResponseCount")) el("caResponseCount").textContent = rt.count || 0;

    // Conversation Depth
    const cd = data.conversationDepth || {};
    if (el("caAvgDepth")) el("caAvgDepth").textContent = cd.avg || 0;
    if (el("caMultiMsg")) el("caMultiMsg").textContent = cd.multiMessage || 0;
    if (el("caSingleMsg")) el("caSingleMsg").textContent = cd.singleMessage || 0;

    // Depth distribution chart
    const distEl = el("caDepthDistribution");
    if (distEl && cd.distribution) {
      const entries = Object.entries(cd.distribution);
      const maxVal = Math.max(...entries.map(([, v]) => v), 1);
      distEl.innerHTML = entries.map(([label, count]) => {
        const height = Math.max(4, (count / maxVal) * 80);
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
          <span style="font-size:10px;font-weight:600;">${count}</span>
          <div style="width:100%;height:${height}px;background:var(--primary);border-radius:4px 4px 0 0;"></div>
          <span style="font-size:9px;color:var(--muted-ink,var(--muted));">${label}</span>
        </div>`;
      }).join("");
    }

    // AI Metrics
    const ai = data.aiMetrics || {};
    if (el("caAiReplies")) el("caAiReplies").textContent = ai.totalAiReplies || 0;
    if (el("caAiRatio")) el("caAiRatio").textContent = `${ai.aiToTotalRatio || 0}%`;
    if (el("caHotRate")) el("caHotRate").textContent = `${ai.hotLeadRate || 0}%`;
    if (el("caConvRate")) el("caConvRate").textContent = `${ai.conversionRate || 0}%`;

    // Activity Heatmap
    renderHeatmap(data.hourlyActivity);

    // Source Breakdown
    renderSourceBreakdown(data.sourceBreakdown);

    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    console.error("Conversation analytics error:", e);
  }
}

function formatSeconds(s) {
  if (!s || s === 0) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function renderHeatmap(hourlyData) {
  const container = document.getElementById("caHeatmap");
  if (!container || !hourlyData) return;

  const { grid, days, hours, max } = hourlyData;
  let html = "";

  // Header row with hours
  html += `<div style="font-weight:600;font-size:10px;"></div>`;
  for (const h of hours) {
    html += `<div style="text-align:center;font-size:9px;font-weight:600;padding:2px 0;">${h}</div>`;
  }

  // Data rows
  for (const day of days) {
    html += `<div style="font-weight:600;font-size:10px;display:flex;align-items:center;">${day}</div>`;
    for (const h of hours) {
      const val = grid[day]?.[h] || 0;
      const intensity = max > 0 ? val / max : 0;
      const bg = intensity === 0
        ? "var(--input-bg)"
        : `rgba(0, 0, 0, ${0.1 + intensity * 0.85})`;
      const textColor = intensity > 0.5 ? "#fff" : "var(--ink)";
      html += `<div class="heatmap-cell" style="background:${bg};color:${textColor};" title="${day} ${h}:00 — ${val} messages">${val || ""}</div>`;
    }
  }

  container.innerHTML = html;
}

function renderSourceBreakdown(sources) {
  const container = document.getElementById("caSourceBreakdown");
  if (!container || !sources) return;

  if (sources.length === 0) {
    container.innerHTML = '<span class="muted">No data available.</span>';
    return;
  }

  const total = sources.reduce((s, v) => s + v.count, 0);
  const colors = [
    "#111111", "#333333", "#555555", "#777777",
    "#999999", "#bbbbbb", "#444444", "#666666",
  ];

  container.innerHTML = sources.map((s, i) => {
    const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
    const color = colors[i % colors.length];
    return `<div style="
      padding:8px 14px;
      border-radius:var(--radius-sm);
      border:1px solid var(--panel-border);
      background:var(--input-bg);
      min-width:120px;
    ">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <div style="width:10px;height:10px;border-radius:50%;background:${color};"></div>
        <span style="font-size:12px;font-weight:600;">${escapeHtml(s.source)}</span>
      </div>
      <div style="font-size:18px;font-weight:700;">${s.count}</div>
      <div style="font-size:10px;color:var(--muted-ink,var(--muted));">${pct}% of total</div>
    </div>`;
  }).join("");
}

// Also refresh conversation analytics when report dates change
const _origRefreshReportsBtn = document.getElementById("refreshReportsBtn");
if (_origRefreshReportsBtn) {
  _origRefreshReportsBtn.addEventListener("click", () => {
    setTimeout(loadConversationAnalytics, 100);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SMART REPLY SUGGESTIONS
// ═══════════════════════════════════════════════════════════════════════════

let _smartRepliesLoading = false;

async function loadSmartReplies() {
  if (!currentWorkspace || !_activeChatContactId || _smartRepliesLoading) return;
  const section = document.getElementById("smartReplySection");
  const container = document.getElementById("smartReplyButtons");
  if (!section || !container) return;

  section.style.display = "block";
  _smartRepliesLoading = true;
  container.innerHTML = '<span class="muted" style="font-size:11px;">Generating suggestions...</span>';

  try {
    const cid = encodeURIComponent(_activeChatContactId);
    const data = await getJson(workspacePath(`/agent/takeover/suggestions/${cid}`));
    const suggestions = data.suggestions || [];

    if (suggestions.length === 0) {
      container.innerHTML = '<span class="muted" style="font-size:11px;">No suggestions available.</span>';
      _smartRepliesLoading = false;
      return;
    }

    const typeIcons = {
      informative: "💡",
      closing: "🎯",
      empathetic: "💬",
      general: "✨",
    };

    container.innerHTML = suggestions.map(s => {
      const icon = typeIcons[s.type] || "✨";
      return `<button class="smart-reply-btn" onclick="useSmartReply(this)" data-text="${escapeAttr(s.text)}" title="${escapeAttr(s.text)}">
        <span class="sr-type">${icon} ${s.type}</span> ${escapeHtml(s.text)}
      </button>`;
    }).join("");
  } catch (e) {
    container.innerHTML = '<span class="muted" style="font-size:11px;">Could not load suggestions.</span>';
    console.error("Smart reply error:", e);
  }
  _smartRepliesLoading = false;
}

function escapeAttr(str) {
  return String(str || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function useSmartReply(btn) {
  const text = btn.dataset.text || "";
  const input = document.getElementById("liveChatInput");
  if (input && text) {
    input.value = text;
    input.focus();
  }
}

// Refresh suggestions button
const refreshSuggestionsBtn = document.getElementById("refreshSuggestionsBtn");
if (refreshSuggestionsBtn) {
  refreshSuggestionsBtn.addEventListener("click", () => {
    loadSmartReplies();
  });
}

// Override openLiveChat to also load smart replies
const _originalOpenLiveChat = window.openLiveChat;
window.openLiveChat = function(contactId) {
  _originalOpenLiveChat(contactId);
  setTimeout(loadSmartReplies, 500);
};
