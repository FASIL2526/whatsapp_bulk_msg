/* ─── Tools Routes ─────────────────────────────────────────────────────────
 *  CSV import/export, deduplication, custom fields, team assignment,
 *  internal notes, branding, and blacklist management.
 * ─────────────────────────────────────────────────────────────────────────── */

const { Router } = require("express");
const { requireWorkspace } = require("../middleware/auth");
const { getWorkspace, hasWorkspaceRole, saveStore } = require("../models/store");
const { sanitizeText, sanitizeChoice } = require("../utils/workspace-config");
const { toCsv } = require("../utils/helpers");
const { isBlacklisted, addToBlacklist, removeFromBlacklist, getBlacklist, importBlacklist } = require("../services/blacklist.service");
const { findDuplicates, mergeDuplicates, autoMergeAll } = require("../services/dedup.service");
const { logAction } = require("../services/audit.service");
const { fireWebhookEvent } = require("../services/webhook.service");

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// LEAD CSV EXPORT
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:workspaceId/leads/export", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];

  // Build CSV with all fields including custom
  const allCustomKeys = new Set();
  for (const lead of leads) {
    if (lead.customData) Object.keys(lead.customData).forEach(k => allCustomKeys.add(k));
  }
  const customCols = [...allCustomKeys].sort();

  const header = ["ID", "Name", "Phone", "Status", "Stage", "Score", "Language", "Assigned To",
    "Tags", "Primary Objection", "Last Message", "Follow-Up Count", "Last Inbound", "Last Outbound",
    "Need", "Budget", "Timeline", "Decision Maker",
    "Notes Count", "Updated At", ...customCols];

  const rows = [header];
  for (const lead of leads) {
    const phone = String(lead.id || "").replace(/@c\.us$|@g\.us$/i, "");
    rows.push([
      lead.id, lead.name || "", phone, lead.status || "cold", lead.stage || "new",
      lead.score || 0, lead.language || "", lead.assignedTo || "",
      (lead.tags || []).join(";"), lead.primaryObjection || "", lead.lastMessage || "",
      lead.followUpCount || 0, lead.lastInboundAt || "", lead.lastOutboundAt || "",
      lead.qualification?.need || "", lead.qualification?.budget || "",
      lead.qualification?.timeline || "", lead.qualification?.decision_maker || "",
      (lead.internalNotes || []).length, lead.updatedAt || "",
      ...customCols.map(k => lead.customData?.[k] || ""),
    ]);
  }

  const csv = toCsv(rows);
  logAction(workspace, req.user.id, "leads.export", { count: leads.length });

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="leads_${workspace.id}_${Date.now()}.csv"`);
  res.send(csv);
});

// ═══════════════════════════════════════════════════════════════════════════
// LEAD CSV IMPORT
// ═══════════════════════════════════════════════════════════════════════════
router.post("/:workspaceId/leads/import", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  if (!Array.isArray(workspace.leads)) workspace.leads = [];

  const { leads: importData } = req.body || {};
  if (!Array.isArray(importData) || importData.length === 0) {
    return res.status(400).json({ ok: false, error: "Array of leads is required." });
  }

  let imported = 0, updated = 0;
  for (const item of importData) {
    const phone = sanitizeText(item.phone || item.id || item.number, "").replace(/[^0-9]/g, "");
    if (!phone) continue;
    const contactId = `${phone}@c.us`;

    let lead = workspace.leads.find(l => l.id === contactId);
    if (!lead) {
      lead = {
        id: contactId,
        name: sanitizeText(item.name, phone),
        status: sanitizeChoice(item.status, ["cold", "warm", "hot"], "cold"),
        reason: "CSV import",
        stage: sanitizeChoice(item.stage, ["new", "qualified", "proposal", "booking", "closed_won", "closed_lost"], "new"),
        score: Math.min(100, Math.max(0, Number(item.score) || 0)),
        language: sanitizeText(item.language, ""),
        assignedTo: sanitizeText(item.assignedTo, ""),
        tags: item.tags ? String(item.tags).split(";").map(t => t.trim()).filter(Boolean) : [],
        lastMessage: "",
        qualification: { need: "", budget: "", timeline: "", decision_maker: "" },
        missingQualificationFields: ["need", "budget", "timeline", "decision_maker"],
        primaryObjection: "",
        followUpCount: 0,
        nextFollowUpAt: "",
        lastInboundAt: "",
        lastOutboundAt: "",
        internalNotes: [],
        customData: {},
        updatedAt: new Date().toISOString(),
      };
      workspace.leads.push(lead);
      imported++;
      fireWebhookEvent(workspace, "lead.created", { leadId: contactId, source: "csv_import" });
    } else {
      // Update existing lead with CSV data (don't overwrite with empty)
      if (item.name) lead.name = sanitizeText(item.name, lead.name);
      if (item.status) lead.status = sanitizeChoice(item.status, ["cold", "warm", "hot"], lead.status);
      if (item.stage) lead.stage = sanitizeChoice(item.stage, ["new", "qualified", "proposal", "booking", "closed_won", "closed_lost"], lead.stage);
      if (item.score) lead.score = Math.min(100, Math.max(0, Number(item.score) || lead.score));
      if (item.tags) lead.tags = String(item.tags).split(";").map(t => t.trim()).filter(Boolean);
      lead.updatedAt = new Date().toISOString();
      updated++;
    }
  }

  saveStore();
  logAction(workspace, req.user.id, "leads.import", { imported, updated, total: importData.length });
  res.json({ ok: true, imported, updated, total: workspace.leads.length });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEAM ASSIGNMENT
// ═══════════════════════════════════════════════════════════════════════════
router.post("/:workspaceId/leads/:contactId/assign", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const contactId = decodeURIComponent(req.params.contactId);
  const lead = (workspace.leads || []).find(l => l.id === contactId);
  if (!lead) return res.status(404).json({ ok: false, error: "Lead not found." });

  const { assignedTo } = req.body || {};
  lead.assignedTo = sanitizeText(assignedTo, "");
  lead.updatedAt = new Date().toISOString();
  saveStore();
  logAction(workspace, req.user.id, "lead.assign", { leadId: contactId, assignedTo: lead.assignedTo });
  res.json({ ok: true, lead });
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL NOTES
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:workspaceId/leads/:contactId/notes", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const contactId = decodeURIComponent(req.params.contactId);
  const lead = (workspace.leads || []).find(l => l.id === contactId);
  if (!lead) return res.status(404).json({ ok: false, error: "Lead not found." });
  res.json({ ok: true, notes: lead.internalNotes || [] });
});

router.post("/:workspaceId/leads/:contactId/notes", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const contactId = decodeURIComponent(req.params.contactId);
  const lead = (workspace.leads || []).find(l => l.id === contactId);
  if (!lead) return res.status(404).json({ ok: false, error: "Lead not found." });

  const { text } = req.body || {};
  if (!text) return res.status(400).json({ ok: false, error: "Note text required." });

  if (!Array.isArray(lead.internalNotes)) lead.internalNotes = [];
  const note = {
    id: `note_${Date.now().toString(36)}`,
    text: sanitizeText(text, ""),
    author: req.user.username,
    authorId: req.user.id,
    createdAt: new Date().toISOString(),
  };
  lead.internalNotes.push(note);
  lead.updatedAt = new Date().toISOString();
  saveStore();
  logAction(workspace, req.user.id, "lead.note.add", { leadId: contactId });
  res.json({ ok: true, note });
});

router.delete("/:workspaceId/leads/:contactId/notes/:noteId", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const contactId = decodeURIComponent(req.params.contactId);
  const lead = (workspace.leads || []).find(l => l.id === contactId);
  if (!lead) return res.status(404).json({ ok: false, error: "Lead not found." });

  if (!Array.isArray(lead.internalNotes)) return res.json({ ok: true });
  lead.internalNotes = lead.internalNotes.filter(n => n.id !== req.params.noteId);
  saveStore();
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM LEAD FIELDS
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:workspaceId/custom-fields", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({ ok: true, fields: workspace.customFields || [] });
});

router.post("/:workspaceId/custom-fields", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  if (!Array.isArray(workspace.customFields)) workspace.customFields = [];

  const { name, type, options } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: "Field name required." });

  const key = sanitizeText(name, "").toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (workspace.customFields.some(f => f.key === key)) {
    return res.status(400).json({ ok: false, error: "Field already exists." });
  }

  const field = {
    id: `cf_${Date.now().toString(36)}`,
    key,
    name: sanitizeText(name, key),
    type: sanitizeChoice(type, ["text", "number", "date", "select", "email", "url", "phone"], "text"),
    options: type === "select" && Array.isArray(options) ? options.map(o => sanitizeText(o, "")).filter(Boolean) : [],
    createdAt: new Date().toISOString(),
  };
  workspace.customFields.push(field);
  saveStore();
  logAction(workspace, req.user.id, "custom_field.create", { field: field.key });
  res.json({ ok: true, field });
});

router.delete("/:workspaceId/custom-fields/:fieldId", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  if (!Array.isArray(workspace.customFields)) return res.json({ ok: true });
  workspace.customFields = workspace.customFields.filter(f => f.id !== req.params.fieldId);
  saveStore();
  res.json({ ok: true });
});

/** Update custom data on a lead */
router.patch("/:workspaceId/leads/:contactId/custom-data", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const contactId = decodeURIComponent(req.params.contactId);
  const lead = (workspace.leads || []).find(l => l.id === contactId);
  if (!lead) return res.status(404).json({ ok: false, error: "Lead not found." });

  const updates = req.body || {};
  if (!lead.customData) lead.customData = {};
  for (const [key, value] of Object.entries(updates)) {
    lead.customData[key] = value;
  }
  lead.updatedAt = new Date().toISOString();
  saveStore();
  res.json({ ok: true, customData: lead.customData });
});

// ═══════════════════════════════════════════════════════════════════════════
// LEAD TAGS
// ═══════════════════════════════════════════════════════════════════════════
router.patch("/:workspaceId/leads/:contactId/tags", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const contactId = decodeURIComponent(req.params.contactId);
  const lead = (workspace.leads || []).find(l => l.id === contactId);
  if (!lead) return res.status(404).json({ ok: false, error: "Lead not found." });

  const { tags } = req.body || {};
  if (!Array.isArray(tags)) return res.status(400).json({ ok: false, error: "Tags array required." });
  lead.tags = tags.map(t => sanitizeText(t, "").toLowerCase()).filter(Boolean);
  lead.updatedAt = new Date().toISOString();
  saveStore();
  res.json({ ok: true, tags: lead.tags });
});

// ═══════════════════════════════════════════════════════════════════════════
// BLACKLIST / DND
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:workspaceId/blacklist", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({ ok: true, blacklist: getBlacklist(workspace) });
});

router.post("/:workspaceId/blacklist", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const { numbers, reason } = req.body || {};
  if (!numbers) return res.status(400).json({ ok: false, error: "Numbers required." });

  const numList = Array.isArray(numbers) ? numbers : String(numbers).split(/[,\n]/).map(n => n.trim()).filter(Boolean);
  const added = addToBlacklist(workspace, numList, sanitizeText(reason, "manual"));
  logAction(workspace, req.user.id, "blacklist.add", { count: added });
  res.json({ ok: true, added, total: getBlacklist(workspace).length });
});

router.post("/:workspaceId/blacklist/import", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const { csv } = req.body || {};
  if (!csv) return res.status(400).json({ ok: false, error: "CSV text required." });

  const added = importBlacklist(workspace, csv, "csv_import");
  logAction(workspace, req.user.id, "blacklist.import", { count: added });
  res.json({ ok: true, added, total: getBlacklist(workspace).length });
});

router.delete("/:workspaceId/blacklist", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const { numbers } = req.body || {};
  if (!numbers) return res.status(400).json({ ok: false, error: "Numbers required." });

  const numList = Array.isArray(numbers) ? numbers : [numbers];
  const removed = removeFromBlacklist(workspace, numList);
  logAction(workspace, req.user.id, "blacklist.remove", { count: removed });
  res.json({ ok: true, removed, total: getBlacklist(workspace).length });
});

// ═══════════════════════════════════════════════════════════════════════════
// DEDUPLICATION
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:workspaceId/leads/duplicates", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const groups = findDuplicates(workspace);
  res.json({ ok: true, groups, totalDuplicates: groups.reduce((sum, g) => sum + g.duplicates.length, 0) });
});

router.post("/:workspaceId/leads/merge", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const { primaryId, duplicateIds } = req.body || {};
  if (!primaryId || !Array.isArray(duplicateIds)) {
    return res.status(400).json({ ok: false, error: "primaryId and duplicateIds[] required." });
  }
  try {
    const result = mergeDuplicates(workspace, primaryId, duplicateIds);
    logAction(workspace, req.user.id, "leads.merge", { primaryId, merged: result.mergedCount });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/:workspaceId/leads/auto-merge", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const result = autoMergeAll(workspace);
  logAction(workspace, req.user.id, "leads.auto_merge", result);
  res.json({ ok: true, ...result });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════════
const { getAuditLog, getActionTypes } = require("../services/audit.service");

router.get("/:workspaceId/audit-log", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const { action, userId, limit, offset } = req.query;
  const result = getAuditLog(workspace, {
    action, userId,
    limit: Number(limit) || 100,
    offset: Number(offset) || 0,
  });
  res.json({ ok: true, ...result });
});

router.get("/:workspaceId/audit-log/actions", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  res.json({ ok: true, actions: getActionTypes(workspace) });
});

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOKS
// ═══════════════════════════════════════════════════════════════════════════
const { WEBHOOK_EVENTS, addWebhook, updateWebhook, removeWebhook, listWebhooks } = require("../services/webhook.service");

router.get("/:workspaceId/webhooks", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  res.json({ ok: true, webhooks: listWebhooks(workspace), availableEvents: WEBHOOK_EVENTS });
});

router.post("/:workspaceId/webhooks", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  try {
    const webhook = addWebhook(workspace, req.body || {});
    logAction(workspace, req.user.id, "webhook.create", { webhookId: webhook.id, url: webhook.url });
    res.json({ ok: true, webhook });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.put("/:workspaceId/webhooks/:webhookId", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  try {
    const webhook = updateWebhook(workspace, req.params.webhookId, req.body || {});
    res.json({ ok: true, webhook });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete("/:workspaceId/webhooks/:webhookId", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const removed = removeWebhook(workspace, req.params.webhookId);
  if (!removed) return res.status(404).json({ ok: false, error: "Webhook not found." });
  logAction(workspace, req.user.id, "webhook.delete", { webhookId: req.params.webhookId });
  res.json({ ok: true });
});

router.post("/:workspaceId/webhooks/:webhookId/test", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const { fireWebhookEvent } = require("../services/webhook.service");
  fireWebhookEvent(workspace, "test", { message: "Test webhook from RestartX", timestamp: new Date().toISOString() });
  res.json({ ok: true, message: "Test event fired." });
});

// ═══════════════════════════════════════════════════════════════════════════
// CHATBOT FLOWS
// ═══════════════════════════════════════════════════════════════════════════
const { createFlow, updateFlow, deleteFlow, listFlows, getFlow } = require("../services/flow.service");

router.get("/:workspaceId/flows", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({ ok: true, flows: listFlows(workspace) });
});

router.post("/:workspaceId/flows", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  try {
    const flow = createFlow(workspace, req.body || {});
    logAction(workspace, req.user.id, "flow.create", { flowId: flow.id, name: flow.name });
    res.json({ ok: true, flow });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.put("/:workspaceId/flows/:flowId", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  try {
    const flow = updateFlow(workspace, req.params.flowId, req.body || {});
    res.json({ ok: true, flow });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete("/:workspaceId/flows/:flowId", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const removed = deleteFlow(workspace, req.params.flowId);
  if (!removed) return res.status(404).json({ ok: false, error: "Flow not found." });
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// BRANDING
// ═══════════════════════════════════════════════════════════════════════════
const { getBranding, updateBranding, resetBranding } = require("../services/branding.service");

router.get("/:workspaceId/branding", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({ ok: true, branding: getBranding(workspace) });
});

router.put("/:workspaceId/branding", (req, res) => {
  const workspace = requireWorkspace(req, res, "owner");
  if (!workspace) return;
  const branding = updateBranding(workspace, req.body || {});
  logAction(workspace, req.user.id, "branding.update", {});
  res.json({ ok: true, branding });
});

router.post("/:workspaceId/branding/reset", (req, res) => {
  const workspace = requireWorkspace(req, res, "owner");
  if (!workspace) return;
  const branding = resetBranding(workspace);
  res.json({ ok: true, branding });
});

// ═══════════════════════════════════════════════════════════════════════════
// STRIPE PAYMENT WEBHOOK (skeleton)
// ═══════════════════════════════════════════════════════════════════════════
router.post("/:workspaceId/billing/stripe-webhook", (req, res) => {
  // This endpoint receives Stripe webhook events
  // Configure STRIPE_WEBHOOK_SECRET in .env and STRIPE_SECRET_KEY
  const event = req.body;
  if (!event || !event.type) return res.status(400).json({ ok: false, error: "Invalid event." });

  console.log(`[STRIPE] Received event: ${event.type}`);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data?.object;
      console.log(`[STRIPE] Checkout completed: ${session?.id}`);
      // TODO: Activate plan based on session metadata
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data?.object;
      console.log(`[STRIPE] Subscription ${event.type}: ${sub?.id}`);
      // TODO: Update user plan status
      break;
    }
    case "invoice.paid": {
      const invoice = event.data?.object;
      console.log(`[STRIPE] Invoice paid: ${invoice?.id}`);
      break;
    }
    default:
      console.log(`[STRIPE] Unhandled event: ${event.type}`);
  }

  res.json({ ok: true, received: true });
});

module.exports = router;
