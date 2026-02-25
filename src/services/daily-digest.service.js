/* ─── Daily Digest Service ──────────────────────────────────────────────────
 *  Generates a natural-language daily summary and sends it to the
 *  operator's WhatsApp every morning.
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore, getRuntime, appendReport } = require("../models/store");
const { sanitizeText } = require("../utils/workspace-config");

function buildDigest(workspace) {
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const bookings = Array.isArray(workspace.bookings) ? workspace.bookings : [];

  const total = leads.length;
  const hot = leads.filter((l) => l.status === "hot").length;
  const warm = leads.filter((l) => l.status === "warm").length;
  const cold = leads.filter((l) => l.status === "cold").length;
  const closedWon = leads.filter((l) => l.stage === "closed_won").length;
  const closedLost = leads.filter((l) => l.stage === "closed_lost").length;

  // Leads that went cold in the last 24h
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const wentCold = leads.filter((l) => {
    if (l.status !== "cold") return false;
    const updated = new Date(l.updatedAt || 0).getTime();
    return updated > oneDayAgo;
  }).length;

  // New leads in last 24h
  const newLeads = leads.filter((l) => {
    const updated = new Date(l.updatedAt || 0).getTime();
    return updated > oneDayAgo && l.stage === "new";
  }).length;

  // Today's bookings
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const todaysBookings = bookings.filter((b) => {
    if (b.status !== "confirmed") return false;
    const start = new Date(b.startAt || "").getTime();
    return start >= todayStart.getTime() && start <= todayEnd.getTime();
  });

  // Reports from last 24h
  const reports = Array.isArray(workspace.reports) ? workspace.reports : [];
  const recentReports = reports.filter(
    (r) => new Date(r.at || 0).getTime() > oneDayAgo
  );
  const messagesSent = recentReports.filter(
    (r) => r.kind === "outgoing" || r.kind === "auto_reply"
  ).length;
  const errors = recentReports.filter((r) => !r.ok).length;

  // Top actionable leads
  const actionable = leads
    .filter(
      (l) =>
        (l.status === "warm" || l.status === "hot") &&
        l.stage !== "closed_won" &&
        l.stage !== "closed_lost"
    )
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5);
  const actionableList = actionable
    .map((l) => `  • ${l.name || l.id?.split("@")[0]} — score ${l.score}, ${l.status}, ${l.stage}`)
    .join("\n");

  const lines = [
    `📊 Daily Digest — ${workspace.name || workspace.id}`,
    `${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`,
    ``,
    `📈 Pipeline: ${total} leads (🔥${hot} hot, 🟡${warm} warm, ❄️${cold} cold)`,
    `✅ Won: ${closedWon} | ❌ Lost: ${closedLost}`,
    `🆕 New today: ${newLeads} | 📉 Went cold: ${wentCold}`,
    `📤 Messages sent (24h): ${messagesSent}${errors > 0 ? ` (${errors} errors)` : ""}`,
  ];

  if (todaysBookings.length > 0) {
    lines.push(`📅 Bookings today: ${todaysBookings.length}`);
    for (const b of todaysBookings) {
      const time = new Date(b.startAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      lines.push(`  • ${b.leadName || b.leadId?.split("@")[0]} at ${time}`);
    }
  } else {
    lines.push(`📅 No bookings today`);
  }

  if (actionable.length > 0) {
    lines.push(``, `🎯 Top actionable leads:`);
    lines.push(actionableList);
  }

  lines.push(``, `💡 Tip: Focus on your hot leads today for the best conversion.`);

  return lines.join("\n");
}

async function processWorkspaceDailyDigest(workspace) {
  if (workspace.config?.AUTO_DAILY_DIGEST_ENABLED !== "true") return false;
  const runtime = getRuntime(workspace.id);
  if (!runtime.client || !runtime.ready) return false;

  const operatorNumber = sanitizeText(workspace.config?.AUTO_DAILY_DIGEST_OPERATOR, "");
  if (!operatorNumber) return false;
  const operatorChatId = operatorNumber.includes("@") ? operatorNumber : `${operatorNumber}@c.us`;

  // Only send once per day
  const lastDigest = workspace._lastDigestDate || "";
  const today = new Date().toISOString().slice(0, 10);
  if (lastDigest === today) return false;

  const hour = new Date().getHours();
  const targetHour = parseInt(workspace.config?.AUTO_DAILY_DIGEST_HOUR || "9", 10) || 9;
  if (hour < targetHour) return false;

  const digest = buildDigest(workspace);
  try {
    await runtime.client.sendMessage(operatorChatId, digest);
    workspace._lastDigestDate = today;
    appendReport(workspace, {
      kind: "daily_digest",
      source: "digest_autopilot",
      ok: true,
      message: "Daily digest sent to operator",
    });
    return true;
  } catch (err) {
    appendReport(workspace, {
      kind: "daily_digest",
      source: "digest_autopilot",
      ok: false,
      error: err.message,
    });
    return false;
  }
}

async function processDailyDigest() {
  try {
    let changed = false;
    for (const ws of store.workspaces) {
      const updated = await processWorkspaceDailyDigest(ws);
      changed = changed || updated;
    }
    if (changed) saveStore();
  } catch (err) {
    console.error(`[ERROR] processDailyDigest: ${err.message}`);
  }
}

module.exports = { processDailyDigest, processWorkspaceDailyDigest, buildDigest };
