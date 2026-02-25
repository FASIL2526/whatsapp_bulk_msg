/* ─── Agent Routes ──────────────────────────────────────────────────────────
 *  API endpoints for the 6 agentic features:
 *  outbound prospecting, goal planner, prompt tuning,
 *  revenue attribution, offer authority, self-healing.
 * ─────────────────────────────────────────────────────────────────────────── */

const { Router } = require("express");
const { requireWorkspace } = require("../middleware/auth");
const { saveStore } = require("../models/store");
const { sanitizeText } = require("../utils/workspace-config");

const {
  getOutboundQueue,
  getOutboundStats,
} = require("../services/outbound-prospecting.service");
const {
  getGoal,
  setGoal,
  clearGoal,
  computePlan,
  getGoalProgressSummary,
  GOAL_TYPES,
} = require("../services/goal-planner.service");
const {
  getTuningInsights,
  applyTuning,
} = require("../services/prompt-tuning.service");
const {
  recordRevenue,
  getRevenueEntries,
  computeAttribution,
  computeScoringFeedback,
} = require("../services/revenue-attribution.service");
const {
  getOfferGuardrails,
  computeOffer,
  buildOfferMessage,
  getOfferStats,
} = require("../services/offer-authority.service");
const {
  getWorkflowHealth,
  applyHealing,
} = require("../services/self-healing.service");
const {
  getAlertConfig,
  getAlertHistory,
  sendTestAlert,
  ALERT_EVENTS,
} = require("../services/whatsapp-alerts.service");

const router = Router();

// ─── Agent overview (all 6 feature statuses) ──────────────────────────────
router.get("/:workspaceId/agent/config", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const cfg = workspace.config || {};
  res.json({
    ok: true,
    agent: {
      outbound:     { enabled: cfg.OUTBOUND_PROSPECTING_ENABLED === "true", maxDaily: cfg.OUTBOUND_MAX_DAILY || "20", cooldownHours: cfg.OUTBOUND_COOLDOWN_HOURS || "6" },
      goalPlanner:  { enabled: cfg.GOAL_PLANNER_ENABLED === "true", type: cfg.GOAL_TYPE || "bookings", weeklyTarget: cfg.GOAL_WEEKLY_TARGET || "5" },
      promptTuning: { enabled: cfg.PROMPT_TUNING_ENABLED === "true" },
      offerAuth:    { enabled: cfg.OFFER_AUTHORITY_ENABLED === "true", maxDiscount: cfg.OFFER_MAX_DISCOUNT_PCT || "15", basePrice: cfg.OFFER_BASE_PRICE || "0", currency: cfg.OFFER_CURRENCY || "USD" },
      revenue:      { enabled: true }, // always available
      selfHealing:  { enabled: cfg.SELF_HEALING_ENABLED === "true" },
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// OUTBOUND PROSPECTING
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:workspaceId/agent/outbound/queue", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const queue = getOutboundQueue(workspace);
  const stats = getOutboundStats(workspace);
  res.json({ ok: true, queue, stats });
});

// ═══════════════════════════════════════════════════════════════════════════
// GOAL PLANNER
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:workspaceId/agent/goal", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const goal = getGoal(workspace);
  const plan = goal ? computePlan(workspace) : null;
  const progress = goal ? getGoalProgressSummary(workspace) : null;
  res.json({ ok: true, goal, plan, progress, goalTypes: Object.keys(GOAL_TYPES).map(k => ({ key: k, label: GOAL_TYPES[k].label })) });
});

router.post("/:workspaceId/agent/goal", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const type = sanitizeText(req.body?.type, "bookings");
  const target = Number(req.body?.weeklyTarget || 5);
  const goal = setGoal(workspace, type, target);
  if (!goal) return res.status(400).json({ ok: false, error: "Invalid goal type" });
  // Also save to config
  workspace.config.GOAL_TYPE = type;
  workspace.config.GOAL_WEEKLY_TARGET = String(target);
  saveStore();
  const plan = computePlan(workspace);
  res.json({ ok: true, goal, plan });
});

router.delete("/:workspaceId/agent/goal", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  clearGoal(workspace);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT TUNING
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:workspaceId/agent/tuning", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({ ok: true, ...getTuningInsights(workspace) });
});

router.post("/:workspaceId/agent/tuning/apply", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const result = applyTuning(workspace);
  res.json({ ok: true, ...result });
});

// ═══════════════════════════════════════════════════════════════════════════
// REVENUE ATTRIBUTION
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:workspaceId/agent/revenue", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const attribution = computeAttribution(workspace);
  const feedback = computeScoringFeedback(workspace);
  res.json({ ok: true, attribution, feedback });
});

router.post("/:workspaceId/agent/revenue", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const { leadId, amount, currency, note } = req.body || {};
  if (!leadId) return res.status(400).json({ ok: false, error: "leadId required" });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ ok: false, error: "amount must be positive" });
  const entry = recordRevenue(workspace, leadId, amount, currency, note);
  res.json({ ok: true, entry });
});

// ═══════════════════════════════════════════════════════════════════════════
// OFFER AUTHORITY
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:workspaceId/agent/offers", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const stats = getOfferStats(workspace);
  const guardrails = getOfferGuardrails(workspace);
  res.json({ ok: true, stats, guardrails });
});

router.post("/:workspaceId/agent/offers/preview", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const leadId = sanitizeText(req.body?.leadId, "");
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return res.status(404).json({ ok: false, error: "Lead not found" });
  const offer = computeOffer(workspace, lead);
  const message = offer ? buildOfferMessage(offer) : null;
  res.json({ ok: true, offer, message });
});

// ═══════════════════════════════════════════════════════════════════════════
// SELF-HEALING
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:workspaceId/agent/health", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({ ok: true, ...getWorkflowHealth(workspace) });
});

router.post("/:workspaceId/agent/health/heal", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const result = applyHealing(workspace);
  res.json({ ok: true, ...result });
});

// ═══════════════════════════════════════════════════════════════════════════
// WHATSAPP ALERTS & AUTO-REPORTS
// ═══════════════════════════════════════════════════════════════════════════

router.get("/:workspaceId/agent/alerts/config", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({ ok: true, ...getAlertConfig(workspace) });
});

router.post("/:workspaceId/agent/alerts/config", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const { enabled, operator, events, reportInterval } = req.body || {};
  if (enabled !== undefined)       workspace.config.WHATSAPP_ALERTS_ENABLED            = enabled ? "true" : "false";
  if (operator !== undefined)      workspace.config.WHATSAPP_ALERTS_OPERATOR           = sanitizeText(operator, "");
  if (Array.isArray(events))       workspace.config.WHATSAPP_ALERTS_EVENTS             = events.join(",");
  if (reportInterval !== undefined) workspace.config.WHATSAPP_ALERTS_REPORT_INTERVAL_HRS = String(Math.min(24, Math.max(1, Number(reportInterval) || 1)));
  saveStore();
  res.json({ ok: true, ...getAlertConfig(workspace) });
});

router.get("/:workspaceId/agent/alerts/history", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({ ok: true, history: getAlertHistory(workspace) });
});

router.post("/:workspaceId/agent/alerts/test", async (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  try {
    await sendTestAlert(workspace);
    res.json({ ok: true, message: "Test alert sent!" });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
