/* ─── Prompt Self-Tuning Service ────────────────────────────────────────────
 *  Analyses which AI reply styles convert best (get replies, advance stage,
 *  book calls) and automatically adjusts the sales persona config:
 *  closing flow, tone, close-question aggressiveness, story usage.
 *  Runs daily as a background sweep.
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore, appendReport } = require("../models/store");
const { DEFAULT_CONFIG } = require("../config/default-config");

// ─── Analyse recent performance ────────────────────────────────────────────
function analyseConversions(workspace) {
  const reports = Array.isArray(workspace.reports) ? workspace.reports : [];
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const now = Date.now();
  const windowMs = 7 * 24 * 60 * 60 * 1000; // last 7 days

  const recentReports = reports.filter(r => (now - new Date(r.at).getTime()) < windowMs);

  // Count outbound messages vs inbound replies
  const outbound = recentReports.filter(r =>
    r.ok && (r.kind === "auto_reply" || r.kind === "auto_follow_up" || r.kind === "outbound_prospect")
  ).length;
  const inboundReplies = recentReports.filter(r =>
    r.ok && r.kind === "auto_reply" && r.incoming
  ).length;
  const replyRate = outbound > 0 ? inboundReplies / outbound : 0;

  // Stage advancement
  const recentHotLeads = leads.filter(l =>
    l.status === "hot" && (now - new Date(l.updatedAt || 0).getTime()) < windowMs
  ).length;
  const recentBookings = (workspace.bookings || []).filter(b =>
    b.status === "confirmed" && (now - new Date(b.createdAt).getTime()) < windowMs
  ).length;
  const recentClosedWon = leads.filter(l =>
    l.stage === "closed_won" && (now - new Date(l.updatedAt || 0).getTime()) < windowMs
  ).length;

  // Objection frequency
  const objectionReports = recentReports.filter(r => r.kind === "objection_rebuttal").length;
  const objectionRate = outbound > 0 ? objectionReports / outbound : 0;

  // Average lead score
  const activeLeads = leads.filter(l => !l.archived && l.stage !== "closed_won" && l.stage !== "closed_lost");
  const avgScore = activeLeads.length > 0
    ? Math.round(activeLeads.reduce((s, l) => s + (l.score || 0), 0) / activeLeads.length)
    : 0;

  return {
    outbound,
    inboundReplies,
    replyRate,
    recentHotLeads,
    recentBookings,
    recentClosedWon,
    objectionRate,
    avgScore,
    activeLeadCount: activeLeads.length,
  };
}

// ─── Generate tuning recommendations ──────────────────────────────────────
function generateTuningRecommendations(metrics) {
  const recs = [];

  // Reply rate analysis
  if (metrics.replyRate < 0.10 && metrics.outbound >= 10) {
    recs.push({
      key: "AI_CLOSING_FLOW",
      from: null, // will be filled with current value
      to: "friendly",
      reason: `Reply rate is very low (${(metrics.replyRate * 100).toFixed(1)}%). Switching to friendlier tone.`,
    });
    recs.push({
      key: "AI_CLOSE_QUESTION_MODE",
      from: null,
      to: "warm_hot",
      reason: "Reducing close pressure to improve engagement.",
    });
  } else if (metrics.replyRate < 0.25 && metrics.outbound >= 10) {
    recs.push({
      key: "AI_CLOSING_FLOW",
      from: null,
      to: "consultative",
      reason: `Reply rate is below target (${(metrics.replyRate * 100).toFixed(1)}%). Trying consultative approach.`,
    });
  } else if (metrics.replyRate > 0.40 && metrics.recentBookings < 2) {
    recs.push({
      key: "AI_CLOSING_FLOW",
      from: null,
      to: "direct",
      reason: `Good reply rate (${(metrics.replyRate * 100).toFixed(1)}%) but low bookings. Going more direct.`,
    });
    recs.push({
      key: "AI_CLOSE_QUESTION_MODE",
      from: null,
      to: "always",
      reason: "Increasing close frequency — leads are engaging but not converting.",
    });
  }

  // Story usage
  if (metrics.replyRate > 0.30 && metrics.recentClosedWon === 0) {
    recs.push({
      key: "AI_AUTO_STORY_TO_CLOSE",
      from: null,
      to: "true",
      reason: "Enabling closing stories to push engaged leads toward conversion.",
    });
  }

  // Objection handling
  if (metrics.objectionRate > 0.30) {
    recs.push({
      key: "AUTO_OBJECTION_ENABLED",
      from: null,
      to: "true",
      reason: `High objection rate (${(metrics.objectionRate * 100).toFixed(1)}%). Ensuring objection recovery is active.`,
    });
  }

  // Status features for low engagement
  if (metrics.replyRate < 0.15 && metrics.outbound >= 20) {
    recs.push({
      key: "AI_WHATSAPP_STATUS_FEATURES",
      from: null,
      to: "true",
      reason: "Enabling status features to drive additional inbound interest.",
    });
    recs.push({
      key: "AI_STATUS_AUTOPILOT_ENABLED",
      from: null,
      to: "true",
      reason: "Activating status autopilot to attract organic leads.",
    });
  }

  return recs;
}

// ─── Apply tuning (with guard: only change once per day) ──────────────────
function applyTuning(workspace) {
  const config = workspace.config || DEFAULT_CONFIG;
  const metrics = analyseConversions(workspace);
  const recs = generateTuningRecommendations(metrics);

  if (recs.length === 0) return { metrics, applied: [], skipped: "no_changes_needed" };

  const applied = [];
  for (const rec of recs) {
    const currentValue = config[rec.key] || DEFAULT_CONFIG[rec.key] || "";
    rec.from = currentValue;
    // Don't change if already at target
    if (currentValue === rec.to) continue;
    config[rec.key] = rec.to;
    applied.push(rec);
  }

  if (applied.length > 0) {
    saveStore();
  }

  return { metrics, applied };
}

// ─── Sweep: run once per day ──────────────────────────────────────────────
let _lastTuneDate = "";

async function processPromptTuning() {
  const today = new Date().toISOString().slice(0, 10);
  if (today === _lastTuneDate) return;

  try {
    for (const workspace of store.workspaces) {
      const config = workspace.config || DEFAULT_CONFIG;
      if (config.PROMPT_TUNING_ENABLED !== "true") continue;

      const result = applyTuning(workspace);
      workspace._lastTuningResult = {
        ...result,
        at: new Date().toISOString(),
      };

      if (result.applied.length > 0) {
        appendReport(workspace, {
          kind: "prompt_tuning",
          source: "prompt_tuner",
          ok: true,
          applied: result.applied.map(r => `${r.key}: ${r.from} → ${r.to} (${r.reason})`),
          metrics: result.metrics,
        });
      }
    }
    _lastTuneDate = today;
  } catch (err) {
    console.error(`[ERROR] processPromptTuning: ${err.message}`);
  }
}

// ─── API helpers ───────────────────────────────────────────────────────────
function getTuningInsights(workspace) {
  const metrics = analyseConversions(workspace);
  const recs = generateTuningRecommendations(metrics);
  const lastResult = workspace._lastTuningResult || null;
  return { metrics, recommendations: recs, lastApplied: lastResult };
}

module.exports = {
  processPromptTuning,
  analyseConversions,
  generateTuningRecommendations,
  applyTuning,
  getTuningInsights,
};
