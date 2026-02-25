/* ─── WhatsApp Alerts Service ───────────────────────────────────────────────
 *  Sends real-time WhatsApp alerts to a configured operator number when
 *  key events happen:  new hot lead, booking confirmed, human requested,
 *  escalation triggered, offer made, lead closed, errors, and more.
 *  Also sends a periodic auto-report (customisable hour).
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore, getRuntime, appendReport } = require("../models/store");
const { sanitizeText } = require("../utils/workspace-config");

// ─── Alert event types the operator can subscribe to ──────────────────────
const ALERT_EVENTS = {
  new_lead:         { label: "New Lead Received",      emoji: "🆕", description: "A brand-new lead messages you for the first time" },
  hot_lead:         { label: "Lead Went Hot",          emoji: "🔥", description: "A lead's status changed to hot (high buying intent)" },
  human_requested:  { label: "Human Requested",        emoji: "🙋", description: "A lead explicitly asked to speak with a real person" },
  booking_confirmed:{ label: "Booking Confirmed",      emoji: "📅", description: "A call/meeting was auto-booked" },
  escalation:       { label: "Escalation Triggered",   emoji: "🚨", description: "AI escalated a lead (stuck, angry, or high-value stalled)" },
  offer_made:       { label: "Offer / Discount Sent",  emoji: "💰", description: "An autonomous discount offer was sent to a lead" },
  closed_won:       { label: "Deal Closed Won",        emoji: "🎉", description: "A lead's stage changed to closed_won" },
  closed_lost:      { label: "Deal Closed Lost",       emoji: "❌", description: "A lead's stage changed to closed_lost" },
  ai_error:         { label: "AI / System Error",      emoji: "⚠️",  description: "An AI request failed or a system error occurred" },
  daily_report:     { label: "Periodic Summary Report", emoji: "📊", description: "Automatic pipeline + performance report (sent every N hours)" },
};

// ─── Queue: buffer alerts per workspace to avoid spam ─────────────────────
const alertQueues = new Map(); // workspaceId → [ { event, data, ts } ]
const THROTTLE_MS = 3000;      // min 3 s between sends to one operator
const lastSentAt = new Map();  // workspaceId → timestamp

function getAlertQueue(workspaceId) {
  if (!alertQueues.has(workspaceId)) alertQueues.set(workspaceId, []);
  return alertQueues.get(workspaceId);
}

// ─── Public: queue an alert ───────────────────────────────────────────────
function queueAlert(workspaceId, event, data = {}) {
  const ws = store.workspaces.find(w => w.id === workspaceId);
  if (!ws) return false;
  const cfg = ws.config || {};

  if (cfg.WHATSAPP_ALERTS_ENABLED !== "true") return false;
  const operator = sanitizeText(cfg.WHATSAPP_ALERTS_OPERATOR, "");
  if (!operator) return false;

  // Check if this event type is enabled
  const enabledEvents = parseEnabledEvents(cfg.WHATSAPP_ALERTS_EVENTS);
  if (!enabledEvents.includes(event) && event !== "daily_report") return false;

  const queue = getAlertQueue(workspaceId);
  queue.push({ event, data, ts: Date.now() });
  return true;
}

function parseEnabledEvents(raw) {
  return String(raw || "new_lead,hot_lead,human_requested,booking_confirmed,escalation,closed_won,ai_error,daily_report")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

// ─── Format individual alert message ──────────────────────────────────────
function formatAlertMessage(workspaceName, event, data) {
  const meta = ALERT_EVENTS[event] || { emoji: "📢", label: event };
  const header = `${meta.emoji} *${meta.label}* — ${workspaceName}`;
  const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const lines = [header, `🕐 ${time}`];

  if (data.leadName || data.leadId) {
    const name = data.leadName || data.leadId?.split("@")[0] || "Unknown";
    lines.push(`👤 Lead: ${name}`);
  }
  if (data.score !== undefined) lines.push(`📈 Score: ${data.score}`);
  if (data.status) lines.push(`📊 Status: ${data.status}`);
  if (data.stage)  lines.push(`📋 Stage: ${data.stage}`);
  if (data.message) lines.push(`💬 "${String(data.message).slice(0, 200)}"`);
  if (data.reason)  lines.push(`📝 ${data.reason}`);
  if (data.error)   lines.push(`❗ Error: ${data.error}`);
  if (data.bookingTime) lines.push(`📅 Booked: ${data.bookingTime}`);
  if (data.offerDetails) lines.push(`💲 Offer: ${data.offerDetails}`);
  if (data.extra) lines.push(data.extra);

  return lines.join("\n");
}

// ─── Process queued alerts (called every 60 s from sweep) ─────────────────
async function processAlertQueue() {
  try {
    for (const ws of store.workspaces) {
      await flushWorkspaceAlerts(ws);
    }
  } catch (err) {
    console.error(`[ERROR] processAlertQueue: ${err.message}`);
  }
}

async function flushWorkspaceAlerts(workspace) {
  const cfg = workspace.config || {};
  if (cfg.WHATSAPP_ALERTS_ENABLED !== "true") return;
  const operator = sanitizeText(cfg.WHATSAPP_ALERTS_OPERATOR, "");
  if (!operator) return;

  const queue = getAlertQueue(workspace.id);
  if (queue.length === 0) return;

  const runtime = getRuntime(workspace.id);
  if (!runtime.client || !runtime.ready) return;

  // Throttle
  const last = lastSentAt.get(workspace.id) || 0;
  if (Date.now() - last < THROTTLE_MS) return;

  const operatorChatId = operator.includes("@") ? operator : `${operator}@c.us`;

  // Drain up to 5 alerts at a time (batch into one message if multiple)
  const batch = queue.splice(0, 5);
  const wsName = workspace.name || workspace.id;
  const messages = batch.map(a => formatAlertMessage(wsName, a.event, a.data));

  const combined = batch.length > 1
    ? `📢 *${batch.length} Alerts* — ${wsName}\n${"─".repeat(30)}\n\n${messages.join("\n\n" + "─".repeat(30) + "\n\n")}`
    : messages[0];

  try {
    await runtime.client.sendMessage(operatorChatId, combined);
    lastSentAt.set(workspace.id, Date.now());
    appendReport(workspace, {
      kind: "whatsapp_alert",
      source: "alerts_service",
      ok: true,
      message: `Sent ${batch.length} alert(s): ${batch.map(a => a.event).join(", ")}`,
    });
  } catch (err) {
    // Put them back for retry
    queue.unshift(...batch);
    appendReport(workspace, {
      kind: "whatsapp_alert",
      source: "alerts_service",
      ok: false,
      error: err.message,
    });
  }
}

// ─── Daily auto-report builder ────────────────────────────────────────────
function buildDailyReport(workspace) {
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const bookings = Array.isArray(workspace.bookings) ? workspace.bookings : [];
  const reports = Array.isArray(workspace.reports) ? workspace.reports : [];

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  // Pipeline counts
  const total = leads.length;
  const hot = leads.filter(l => l.status === "hot").length;
  const warm = leads.filter(l => l.status === "warm").length;
  const cold = leads.filter(l => l.status === "cold").length;
  const closedWon = leads.filter(l => l.stage === "closed_won").length;
  const closedLost = leads.filter(l => l.stage === "closed_lost").length;

  // 24h metrics
  const recentLeads = leads.filter(l => new Date(l.updatedAt || 0).getTime() > oneDayAgo);
  const newLeads24h = recentLeads.filter(l => l.stage === "new").length;
  const hotToday = recentLeads.filter(l => l.status === "hot").length;
  const wentCold24h = recentLeads.filter(l => l.status === "cold").length;

  // Messages
  const recentReports = reports.filter(r => new Date(r.at || 0).getTime() > oneDayAgo);
  const msgSent = recentReports.filter(r => r.kind === "outgoing" || r.kind === "auto_reply").length;
  const errors24h = recentReports.filter(r => !r.ok).length;
  const escalations24h = recentReports.filter(r => r.kind === "auto_escalation" && r.ok).length;
  const offers24h = recentReports.filter(r => r.kind === "offer_sent" || r.source === "offer_authority").length;

  // Bookings today
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const todaysBookings = bookings.filter(b => {
    if (b.status !== "confirmed") return false;
    const s = new Date(b.startAt || "").getTime();
    return s >= todayStart.getTime() && s <= todayEnd.getTime();
  });

  // Revenue (last 7 days)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const revenue = (workspace._revenue || [])
    .filter(r => new Date(r.at || 0).getTime() > sevenDaysAgo)
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  // Top 5 actionable
  const actionable = leads
    .filter(l => (l.status === "hot" || l.status === "warm") && l.stage !== "closed_won" && l.stage !== "closed_lost")
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5);

  // Agent features status
  const cfg = workspace.config || {};
  const agentOn = ["OUTBOUND_PROSPECTING_ENABLED", "GOAL_PLANNER_ENABLED", "PROMPT_TUNING_ENABLED", "OFFER_AUTHORITY_ENABLED", "SELF_HEALING_ENABLED"]
    .filter(k => cfg[k] === "true").length;
  const automationOn = ["NURTURE_DRIP_ENABLED", "AUTO_REENGAGE_ENABLED", "AUTO_ESCALATION_ENABLED", "AI_FOLLOW_UP_ENABLED", "AUTO_TAGGING_ENABLED"]
    .filter(k => cfg[k] === "true").length;

  const wsName = workspace.name || workspace.id;
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });

  const lines = [
    `📊 *AUTO REPORT — ${wsName}*`,
    `📅 ${date}`,
    ``,
    `━━━━ 📈 PIPELINE ━━━━`,
    `Total: ${total} leads`,
    `🔥 Hot: ${hot} | 🟡 Warm: ${warm} | ❄️ Cold: ${cold}`,
    `✅ Won: ${closedWon} | ❌ Lost: ${closedLost}`,
    ``,
    `━━━━ ⏱️ LAST 24 HOURS ━━━━`,
    `🆕 New leads: ${newLeads24h}`,
    `🔥 Went hot: ${hotToday}`,
    `📉 Went cold: ${wentCold24h}`,
    `📤 Messages sent: ${msgSent}`,
    `🚨 Escalations: ${escalations24h}`,
    `💰 Offers sent: ${offers24h}`,
    errors24h > 0 ? `⚠️ Errors: ${errors24h}` : `✅ No errors`,
    ``,
  ];

  if (todaysBookings.length > 0) {
    lines.push(`━━━━ 📅 TODAY'S BOOKINGS ━━━━`);
    todaysBookings.forEach(b => {
      const time = new Date(b.startAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      lines.push(`• ${b.leadName || b.leadId?.split("@")[0]} at ${time}`);
    });
    lines.push(``);
  }

  if (revenue > 0) {
    const cur = sanitizeText(cfg.OFFER_CURRENCY, "USD");
    lines.push(`━━━━ 💵 REVENUE (7 DAYS) ━━━━`);
    lines.push(`Total: ${cur} ${revenue.toLocaleString()}`);
    lines.push(``);
  }

  if (actionable.length > 0) {
    lines.push(`━━━━ 🎯 TOP ACTIONABLE LEADS ━━━━`);
    actionable.forEach(l => {
      lines.push(`• ${l.name || l.id?.split("@")[0]} — score ${l.score || 0}, ${l.status}, ${l.stage || "new"}`);
    });
    lines.push(``);
  }

  lines.push(`━━━━ 🤖 SYSTEM STATUS ━━━━`);
  lines.push(`AI: ${cfg.AI_SALES_ENABLED === "true" ? "✅ ON" : "⛔ OFF"} (${cfg.AI_PROVIDER || "google"}/${cfg.AI_MODEL || "gemini"})`);
  lines.push(`Automations active: ${automationOn}/5`);
  lines.push(`Agent features active: ${agentOn}/5`);
  lines.push(`Alerts: ✅ ON`);
  lines.push(``);
  lines.push(`💡 _Focus on hot leads for highest conversion today._`);

  return lines.join("\n");
}

// ─── Periodic report sender (called from 5-min sweep, interval-based) ────
async function processAutoReport() {
  try {
    let changed = false;
    for (const ws of store.workspaces) {
      const ok = await sendPeriodicReport(ws);
      changed = changed || ok;
    }
    if (changed) saveStore();
  } catch (err) {
    console.error(`[ERROR] processAutoReport: ${err.message}`);
  }
}

async function sendPeriodicReport(workspace) {
  const cfg = workspace.config || {};
  if (cfg.WHATSAPP_ALERTS_ENABLED !== "true") return false;
  const operator = sanitizeText(cfg.WHATSAPP_ALERTS_OPERATOR, "");
  if (!operator) return false;

  // Check if daily_report event is enabled
  const enabledEvents = parseEnabledEvents(cfg.WHATSAPP_ALERTS_EVENTS);
  if (!enabledEvents.includes("daily_report")) return false;

  const runtime = getRuntime(workspace.id);
  if (!runtime.client || !runtime.ready) return false;

  // Interval guard: send every N hours (default 1)
  const intervalHrs = Math.max(1, parseInt(cfg.WHATSAPP_ALERTS_REPORT_INTERVAL_HRS || "1", 10) || 1);
  const intervalMs = intervalHrs * 60 * 60 * 1000;
  const lastSentTs = workspace._lastAlertReportTs || 0;
  const now = Date.now();
  if (now - lastSentTs < intervalMs) return false;

  const operatorChatId = operator.includes("@") ? operator : `${operator}@c.us`;
  const report = buildDailyReport(workspace);

  try {
    await runtime.client.sendMessage(operatorChatId, report);
    workspace._lastAlertReportTs = now;
    appendReport(workspace, {
      kind: "auto_report",
      source: "alerts_service",
      ok: true,
      message: `Periodic report sent (every ${intervalHrs}h)`,
    });
    return true;
  } catch (err) {
    appendReport(workspace, {
      kind: "auto_report",
      source: "alerts_service",
      ok: false,
      error: err.message,
    });
    return false;
  }
}

// ─── Get alert history for UI ─────────────────────────────────────────────
function getAlertHistory(workspace) {
  const reports = Array.isArray(workspace.reports) ? workspace.reports : [];
  return reports
    .filter(r => r.source === "alerts_service")
    .slice(-50)
    .reverse();
}

function getAlertConfig(workspace) {
  const cfg = workspace.config || {};
  return {
    enabled: cfg.WHATSAPP_ALERTS_ENABLED === "true",
    operator: sanitizeText(cfg.WHATSAPP_ALERTS_OPERATOR, ""),
    events: parseEnabledEvents(cfg.WHATSAPP_ALERTS_EVENTS),
    reportInterval: Math.max(1, parseInt(cfg.WHATSAPP_ALERTS_REPORT_INTERVAL_HRS || "1", 10) || 1),
    allEvents: Object.entries(ALERT_EVENTS).map(([key, val]) => ({
      key,
      label: val.label,
      emoji: val.emoji,
      description: val.description,
    })),
  };
}

// ─── Send a test alert ────────────────────────────────────────────────────
async function sendTestAlert(workspace) {
  const cfg = workspace.config || {};
  const operator = sanitizeText(cfg.WHATSAPP_ALERTS_OPERATOR, "");
  if (!operator) throw new Error("No alert operator number configured");

  const runtime = getRuntime(workspace.id);
  if (!runtime.client || !runtime.ready) throw new Error("WhatsApp client is not connected");

  const operatorChatId = operator.includes("@") ? operator : `${operator}@c.us`;
  const msg = formatAlertMessage(workspace.name || workspace.id, "new_lead", {
    leadName: "Test Lead",
    score: 85,
    status: "hot",
    stage: "qualified",
    message: "This is a test alert to verify your notification setup works! 🎉",
  });

  await runtime.client.sendMessage(operatorChatId, `🧪 *TEST ALERT*\n\n${msg}\n\n✅ Alerts are working!`);
  return true;
}

module.exports = {
  ALERT_EVENTS,
  queueAlert,
  processAlertQueue,
  processAutoReport,
  buildDailyReport,
  getAlertHistory,
  getAlertConfig,
  sendTestAlert,
  formatAlertMessage,
};
