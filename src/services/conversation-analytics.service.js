/* ─── Conversation Analytics Service ───────────────────────────────────────
 *  Computes deeper analytics from reports and lead data:
 *  - Response time metrics
 *  - Conversation length & drop-off
 *  - Hourly / daily activity heatmap
 *  - Lead conversion funnel with rates
 *  - AI performance metrics
 * ─────────────────────────────────────────────────────────────────────────── */

const { getReportWindow, getWorkspaceReports } = require("./report.service");

// ─── Response time analysis ────────────────────────────────────────────────
function computeResponseTimes(reports) {
  // Pair up inbound → next outbound (auto_reply or outgoing)
  const sorted = [...reports].sort((a, b) => new Date(a.at) - new Date(b.at));
  const responseTimes = [];
  const contactLastInbound = {};

  for (const entry of sorted) {
    const contact = entry.from || entry.to || "";
    if (entry.kind === "incoming" || entry.source === "incoming") {
      contactLastInbound[contact] = new Date(entry.at).getTime();
    } else if (
      (entry.kind === "auto_reply" || entry.kind === "outgoing") &&
      contactLastInbound[contact]
    ) {
      const delta = new Date(entry.at).getTime() - contactLastInbound[contact];
      if (delta > 0 && delta < 24 * 60 * 60 * 1000) {
        // Under 24h
        responseTimes.push(delta / 1000); // in seconds
      }
      delete contactLastInbound[contact];
    }
  }

  if (responseTimes.length === 0) {
    return { avg: 0, median: 0, p95: 0, count: 0, unit: "seconds" };
  }

  responseTimes.sort((a, b) => a - b);
  const avg = responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length;
  const median = responseTimes[Math.floor(responseTimes.length / 2)];
  const p95 = responseTimes[Math.floor(responseTimes.length * 0.95)];

  return {
    avg: Math.round(avg),
    median: Math.round(median),
    p95: Math.round(p95),
    count: responseTimes.length,
    unit: "seconds",
  };
}

// ─── Hourly activity heatmap ───────────────────────────────────────────────
function computeHourlyActivity(reports) {
  // 7 days × 24 hours grid
  const grid = {};
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const day of days) {
    grid[day] = new Array(24).fill(0);
  }

  for (const entry of reports) {
    const d = new Date(entry.at);
    if (isNaN(d.getTime())) continue;
    const dayName = days[d.getDay()];
    const hour = d.getHours();
    grid[dayName][hour]++;
  }

  // Find max for scaling
  let max = 0;
  for (const day of days) {
    for (const v of grid[day]) {
      if (v > max) max = v;
    }
  }

  return { grid, days, hours: Array.from({ length: 24 }, (_, i) => i), max };
}

// ─── Conversation depth (messages per contact) ────────────────────────────
function computeConversationDepth(reports) {
  const contactMessages = {};
  for (const entry of reports) {
    const contact = entry.from || entry.to || "unknown";
    if (!contactMessages[contact]) contactMessages[contact] = { inbound: 0, outbound: 0 };
    if (entry.kind === "incoming" || entry.source === "incoming") {
      contactMessages[contact].inbound++;
    } else {
      contactMessages[contact].outbound++;
    }
  }

  const depths = Object.values(contactMessages).map(c => c.inbound + c.outbound);
  if (depths.length === 0) return { avg: 0, max: 0, singleMessage: 0, multiMessage: 0, totalConversations: 0 };

  depths.sort((a, b) => a - b);
  const avg = depths.reduce((s, v) => s + v, 0) / depths.length;
  const singleMessage = depths.filter(d => d <= 1).length;
  const multiMessage = depths.filter(d => d > 1).length;

  return {
    avg: Math.round(avg * 10) / 10,
    max: depths[depths.length - 1],
    singleMessage,
    multiMessage,
    totalConversations: depths.length,
    distribution: buildDistribution(depths),
  };
}

function buildDistribution(depths) {
  const buckets = { "1": 0, "2-3": 0, "4-6": 0, "7-10": 0, "11-20": 0, "20+": 0 };
  for (const d of depths) {
    if (d <= 1) buckets["1"]++;
    else if (d <= 3) buckets["2-3"]++;
    else if (d <= 6) buckets["4-6"]++;
    else if (d <= 10) buckets["7-10"]++;
    else if (d <= 20) buckets["11-20"]++;
    else buckets["20+"]++;
  }
  return buckets;
}

// ─── AI performance metrics ────────────────────────────────────────────────
function computeAiMetrics(reports, leads) {
  const aiReplies = reports.filter(r => r.kind === "auto_reply" || r.source === "ai_sales");
  const followUps = reports.filter(r => r.kind === "auto_follow_up");
  const objections = reports.filter(r => r.kind === "objection_rebuttal");
  const totalOutbound = reports.filter(r =>
    r.kind === "outgoing" || r.kind === "auto_reply" || r.kind === "auto_follow_up"
  ).length;

  // Lead progression from AI interactions
  const hotLeads = (leads || []).filter(l => l.status === "hot").length;
  const warmLeads = (leads || []).filter(l => l.status === "warm").length;
  const closedWon = (leads || []).filter(l => l.stage === "closed_won").length;
  const totalLeads = (leads || []).length;

  return {
    totalAiReplies: aiReplies.length,
    totalFollowUps: followUps.length,
    totalObjectionRebuttals: objections.length,
    aiToTotalRatio: totalOutbound > 0 ? Math.round((aiReplies.length / totalOutbound) * 100) : 0,
    hotLeadRate: totalLeads > 0 ? Math.round((hotLeads / totalLeads) * 100) : 0,
    warmLeadRate: totalLeads > 0 ? Math.round((warmLeads / totalLeads) * 100) : 0,
    conversionRate: totalLeads > 0 ? Math.round((closedWon / totalLeads) * 100) : 0,
  };
}

// ─── Lead conversion funnel with rates ─────────────────────────────────────
function computeConversionFunnel(leads) {
  const allLeads = Array.isArray(leads) ? leads : [];
  const stages = ["new", "qualified", "proposal", "booking", "closed_won", "closed_lost"];
  const funnel = {};
  for (const stage of stages) {
    funnel[stage] = allLeads.filter(l => l.stage === stage).length;
  }

  // Conversion rates between stages
  const rates = {};
  for (let i = 1; i < stages.length - 1; i++) {
    const prev = funnel[stages[i - 1]] || 0;
    const curr = funnel[stages[i]] || 0;
    rates[`${stages[i - 1]}_to_${stages[i]}`] = prev > 0 ? Math.round((curr / prev) * 100) : 0;
  }

  return { funnel, rates, total: allLeads.length };
}

// ─── Source breakdown ──────────────────────────────────────────────────────
function computeSourceBreakdown(reports) {
  const sources = {};
  for (const entry of reports) {
    const src = entry.source || entry.kind || "unknown";
    sources[src] = (sources[src] || 0) + 1;
  }
  return Object.entries(sources)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({ source, count }));
}

// ─── Combined analytics ───────────────────────────────────────────────────
function getConversationAnalytics(workspace, query) {
  const window = getReportWindow(query || {});
  const reports = getWorkspaceReports(workspace, window);
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];

  return {
    period: {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    },
    responseTimes: computeResponseTimes(reports),
    hourlyActivity: computeHourlyActivity(reports),
    conversationDepth: computeConversationDepth(reports),
    aiMetrics: computeAiMetrics(reports, leads),
    conversionFunnel: computeConversionFunnel(leads),
    sourceBreakdown: computeSourceBreakdown(reports),
  };
}

module.exports = {
  getConversationAnalytics,
  computeResponseTimes,
  computeHourlyActivity,
  computeConversationDepth,
  computeAiMetrics,
  computeConversionFunnel,
  computeSourceBreakdown,
};
