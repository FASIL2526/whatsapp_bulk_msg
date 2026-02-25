/* ─── Automation Routes ─────────────────────────────────────────────────────
 *  API endpoints for all 10 autonomous features.
 * ─────────────────────────────────────────────────────────────────────────── */

const { Router } = require("express");
const { requireWorkspace } = require("../middleware/auth");
const { saveStore, getRuntime } = require("../models/store");
const { sanitizeText, sanitizeMultilineText } = require("../utils/workspace-config");

const { enrollLeadInDrip, unenrollLeadFromDrip, getDripSteps } = require("../services/nurture-drip.service");
const { buildDigest } = require("../services/daily-digest.service");
const { detectEscalationNeed } = require("../services/escalation.service");
const { routeLead } = require("../services/lead-routing.service");
const { createAbTest, getActiveTest } = require("../services/ab-testing.service");
const { getObjectionRebuttal, detectObjection } = require("../services/objection.service");
const { detectTimezone, isOptimalSendTime, msUntilOptimalWindow } = require("../services/timezone.service");
const { computeTags } = require("../services/tagging.service");

const router = Router();

// ─── Automation config (get/set all autonomous feature flags) ──────────────
router.get("/:workspaceId/automation/config", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const cfg = workspace.config || {};
  res.json({
    ok: true,
    automation: {
      nurtureDrip:    { enabled: cfg.NURTURE_DRIP_ENABLED === "true", steps: getDripSteps(workspace) },
      reengage:       { enabled: cfg.AUTO_REENGAGE_ENABLED === "true", staleDays: cfg.AUTO_REENGAGE_STALE_DAYS || "3", maxAttempts: cfg.AUTO_REENGAGE_MAX_ATTEMPTS || "2" },
      escalation:     { enabled: cfg.AUTO_ESCALATION_ENABLED === "true", operator: cfg.AUTO_ESCALATION_OPERATOR || "" },
      leadRouting:    { enabled: cfg.AUTO_LEAD_ROUTING_ENABLED === "true" },
      abTesting:      { enabled: cfg.AB_TEST_ENABLED === "true", minSends: cfg.AB_TEST_MIN_SENDS || "30" },
      dailyDigest:    { enabled: cfg.AUTO_DAILY_DIGEST_ENABLED === "true", operator: cfg.AUTO_DAILY_DIGEST_OPERATOR || "", hour: cfg.AUTO_DAILY_DIGEST_HOUR || "9" },
      objection:      { enabled: cfg.AUTO_OBJECTION_ENABLED === "true" },
      cleanup:        { enabled: cfg.AUTO_CLEANUP_ENABLED === "true", staleDays: cfg.AUTO_CLEANUP_STALE_DAYS || "30" },
      timezone:       { enabled: cfg.AUTO_TIMEZONE_ENABLED === "true" },
      tagging:        { enabled: cfg.AUTO_TAGGING_ENABLED === "true" },
    },
  });
});

// ─── Nurture Drip ──────────────────────────────────────────────────────────
router.post("/:workspaceId/automation/drip/enroll", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const leadId = sanitizeText(req.body?.leadId, "");
  if (!leadId) return res.status(400).json({ ok: false, error: "leadId required" });
  const enrolled = enrollLeadInDrip(workspace, leadId);
  res.json({ ok: true, enrolled });
});

router.post("/:workspaceId/automation/drip/unenroll", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const leadId = sanitizeText(req.body?.leadId, "");
  if (!leadId) return res.status(400).json({ ok: false, error: "leadId required" });
  unenrollLeadFromDrip(workspace, leadId);
  res.json({ ok: true });
});

router.post("/:workspaceId/automation/drip/enroll-all", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  let count = 0;
  for (const lead of leads) {
    if (lead.stage === "closed_won" || lead.stage === "closed_lost" || lead.archived) continue;
    if (lead.dripStartedAt) continue;
    const enrolled = enrollLeadInDrip(workspace, lead.id);
    if (enrolled) count++;
  }
  res.json({ ok: true, enrolled: count });
});

// ─── A/B Testing ───────────────────────────────────────────────────────────
router.post("/:workspaceId/automation/ab-test", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const name = sanitizeText(req.body?.name, "A/B Test");
  const messages = Array.isArray(req.body?.messages)
    ? req.body.messages.map((m) => sanitizeMultilineText(m, "")).filter(Boolean)
    : [];
  if (messages.length < 2) return res.status(400).json({ ok: false, error: "Need at least 2 message variants" });
  const test = createAbTest(workspace, name, messages);
  res.json({ ok: true, test });
});

router.get("/:workspaceId/automation/ab-test", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({ ok: true, tests: Array.isArray(workspace.abTests) ? workspace.abTests : [] });
});

router.get("/:workspaceId/automation/ab-test/active", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({ ok: true, test: getActiveTest(workspace) });
});

// ─── Daily Digest ──────────────────────────────────────────────────────────
router.get("/:workspaceId/automation/digest/preview", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({ ok: true, digest: buildDigest(workspace) });
});

// ─── Lead Routing ──────────────────────────────────────────────────────────
router.get("/:workspaceId/automation/routing", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const routed = leads.map((l) => ({
    id: l.id,
    name: l.name,
    score: l.score,
    status: l.status,
    stage: l.stage,
    route: l.route || routeLead(l),
    tags: l.tags || [],
  }));
  res.json({ ok: true, leads: routed });
});

// ─── Escalation check ─────────────────────────────────────────────────────
router.get("/:workspaceId/automation/escalation/check", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const needEscalation = leads
    .filter((l) => !l.escalatedAt && l.stage !== "closed_won" && l.stage !== "closed_lost")
    .map((l) => ({ id: l.id, name: l.name, reasons: detectEscalationNeed(l, workspace) }))
    .filter((l) => l.reasons.length > 0);
  res.json({ ok: true, leads: needEscalation });
});

// ─── Timezone ──────────────────────────────────────────────────────────────
router.get("/:workspaceId/automation/timezone/:contactId", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const contactId = decodeURIComponent(req.params.contactId);
  const tz = detectTimezone(contactId);
  const optimal = isOptimalSendTime(contactId);
  const waitMs = msUntilOptimalWindow(contactId);
  res.json({ ok: true, contactId, timezone: tz, isOptimalNow: optimal, waitMs });
});

// ─── Tags ──────────────────────────────────────────────────────────────────
router.get("/:workspaceId/automation/tags", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const tagged = leads
    .filter((l) => !l.archived)
    .map((l) => ({
      id: l.id,
      name: l.name,
      tags: l.tags || computeTags(l, workspace.id),
    }));
  res.json({ ok: true, leads: tagged });
});

router.post("/:workspaceId/automation/tags/:contactId", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const contactId = decodeURIComponent(req.params.contactId);
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const lead = leads.find((l) => l.id === contactId);
  if (!lead) return res.status(404).json({ ok: false, error: "Lead not found" });
  const newTags = Array.isArray(req.body?.tags) ? req.body.tags.map((t) => sanitizeText(t, "")).filter(Boolean) : [];
  lead.tags = [...new Set([...(lead.tags || []), ...newTags])];
  lead.updatedAt = new Date().toISOString();
  saveStore();
  res.json({ ok: true, tags: lead.tags });
});

// ─── Objection test ────────────────────────────────────────────────────────
router.post("/:workspaceId/automation/objection/test", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const message = sanitizeText(req.body?.message, "");
  const objection = detectObjection(message);
  const rebuttal = getObjectionRebuttal(workspace, message);
  res.json({ ok: true, objection, rebuttal });
});

module.exports = router;
