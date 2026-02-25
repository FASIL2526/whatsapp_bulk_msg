/* ─── Revenue Attribution Service ───────────────────────────────────────────
 *  Tracks which leads converted to actual revenue, attributes revenue
 *  to campaigns/channels, and feeds conversion data back into
 *  lead scoring weights. Provides ROI visibility.
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore, appendReport } = require("../models/store");
const { DEFAULT_CONFIG } = require("../config/default-config");
const { sanitizeText } = require("../utils/workspace-config");

// ─── Revenue entry CRUD ────────────────────────────────────────────────────
function recordRevenue(workspace, leadId, amount, currency, note) {
  if (!workspace._revenue) workspace._revenue = [];
  const entry = {
    id: `rev_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`,
    leadId: sanitizeText(leadId, ""),
    amount: Math.max(0, Number(amount) || 0),
    currency: sanitizeText(currency, "USD"),
    note: sanitizeText(note, ""),
    createdAt: new Date().toISOString(),
  };
  workspace._revenue.push(entry);

  // Mark lead as closed_won if not already
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const lead = leads.find(l => l.id === leadId);
  if (lead && lead.stage !== "closed_won") {
    lead.stage = "closed_won";
    lead.status = "hot";
    lead.updatedAt = new Date().toISOString();
  }

  saveStore();
  appendReport(workspace, {
    kind: "revenue_recorded",
    source: "revenue_attribution",
    ok: true,
    leadId,
    amount: entry.amount,
    currency: entry.currency,
  });
  return entry;
}

function getRevenueEntries(workspace) {
  return workspace._revenue || [];
}

// ─── Attribution analytics ─────────────────────────────────────────────────
function computeAttribution(workspace) {
  const revenue = workspace._revenue || [];
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const reports = Array.isArray(workspace.reports) ? workspace.reports : [];

  // Total revenue
  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const currency = revenue[0]?.currency || "USD";

  // Revenue by source (first-touch attribution)
  const sourceRevenue = {};
  for (const rev of revenue) {
    const lead = leads.find(l => l.id === rev.leadId);
    if (!lead) continue;
    // Find the first report about this lead to determine source
    const firstTouch = reports.find(r => r.from === rev.leadId && r.ok);
    const source = firstTouch?.source || "unknown";
    if (!sourceRevenue[source]) sourceRevenue[source] = 0;
    sourceRevenue[source] += rev.amount;
  }

  // Conversion funnel
  const totalLeads = leads.length;
  const qualifiedLeads = leads.filter(l => l.stage === "qualified" || l.stage === "proposal" || l.stage === "booking" || l.stage === "closed_won").length;
  const closedWon = leads.filter(l => l.stage === "closed_won").length;
  const conversionRate = totalLeads > 0 ? Math.round((closedWon / totalLeads) * 100) : 0;

  // Average deal size
  const avgDealSize = closedWon > 0 ? Math.round(totalRevenue / closedWon) : 0;

  // Revenue per lead (efficiency)
  const revenuePerLead = totalLeads > 0 ? Math.round(totalRevenue / totalLeads) : 0;

  // Time to close (avg days from first contact to closed_won)
  const closeTimes = [];
  for (const lead of leads.filter(l => l.stage === "closed_won")) {
    const firstReport = reports.find(r => r.from === lead.id && r.ok);
    if (firstReport) {
      const days = Math.round(
        (new Date(lead.updatedAt).getTime() - new Date(firstReport.at).getTime()) /
        (1000 * 60 * 60 * 24)
      );
      if (days >= 0) closeTimes.push(days);
    }
  }
  const avgDaysToClose = closeTimes.length > 0
    ? Math.round(closeTimes.reduce((s, d) => s + d, 0) / closeTimes.length)
    : 0;

  // Campaign ROI (messages sent vs revenue)
  const totalMessages = reports.filter(r =>
    r.ok && (r.kind === "outgoing" || r.kind === "auto_reply" || r.kind === "auto_follow_up" || r.kind === "outbound_prospect")
  ).length;
  const costPerMessage = 0; // WhatsApp is free, but can be configured
  const roi = totalMessages > 0 && totalRevenue > 0
    ? `${Math.round(totalRevenue / Math.max(1, totalMessages))} ${currency}/message`
    : "N/A";

  return {
    totalRevenue,
    currency,
    totalLeads,
    qualifiedLeads,
    closedWon,
    conversionRate,
    avgDealSize,
    revenuePerLead,
    avgDaysToClose,
    totalMessages,
    roi,
    sourceRevenue,
    entries: revenue.slice(-50), // last 50 entries
  };
}

// ─── Scoring weight feedback ──────────────────────────────────────────────
// Analyses what converted leads have in common and returns scoring hints
function computeScoringFeedback(workspace) {
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const won = leads.filter(l => l.stage === "closed_won");
  const lost = leads.filter(l => l.stage === "closed_lost");
  if (won.length < 2) return null;

  // What do winning leads have in common?
  const wonAvgScore = Math.round(won.reduce((s, l) => s + (l.score || 0), 0) / won.length);
  const wonAvgFollowUp = Math.round(won.reduce((s, l) => s + (l.followUpCount || 0), 0) / won.length);
  const wonWithBooking = won.filter(l => l.stage === "booking" || (workspace.bookings || []).some(b => b.leadId === l.id)).length;
  const wonWithObjection = won.filter(l => l.primaryObjection).length;

  // Tags frequency in won leads
  const tagFreq = {};
  for (const lead of won) {
    for (const tag of (lead.tags || [])) {
      tagFreq[tag] = (tagFreq[tag] || 0) + 1;
    }
  }
  const topTags = Object.entries(tagFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count, pct: Math.round((count / won.length) * 100) }));

  // Status at close
  const statusAtClose = {};
  for (const lead of won) {
    const s = lead.status || "unknown";
    statusAtClose[s] = (statusAtClose[s] || 0) + 1;
  }

  return {
    wonCount: won.length,
    lostCount: lost.length,
    winRate: Math.round((won.length / Math.max(1, won.length + lost.length)) * 100),
    wonAvgScore,
    wonAvgFollowUp,
    wonBookingRate: Math.round((wonWithBooking / won.length) * 100),
    wonObjectionRate: Math.round((wonWithObjection / won.length) * 100),
    topConvertingTags: topTags,
    statusAtClose,
    insight: wonAvgFollowUp >= 2
      ? "Follow-ups are critical — winning leads needed an average of " + wonAvgFollowUp + " touches."
      : "Quick conversions — most wins happen with minimal follow-ups.",
  };
}

// ─── Weekly period helpers ─────────────────────────────────────────────────
function getWeeklyRevenue(workspace) {
  const revenue = workspace._revenue || [];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return revenue
    .filter(r => new Date(r.createdAt) >= weekAgo)
    .reduce((s, r) => s + r.amount, 0);
}

function getMonthlyRevenue(workspace) {
  const revenue = workspace._revenue || [];
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return revenue
    .filter(r => new Date(r.createdAt) >= monthAgo)
    .reduce((s, r) => s + r.amount, 0);
}

module.exports = {
  recordRevenue,
  getRevenueEntries,
  computeAttribution,
  computeScoringFeedback,
  getWeeklyRevenue,
  getMonthlyRevenue,
};
