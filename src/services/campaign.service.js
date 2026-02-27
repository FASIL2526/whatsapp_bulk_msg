/* ─── Campaign Service ──────────────────────────────────────────────────────
 *  Campaign CRUD, audience targeting, template library, personalization,
 *  per-campaign analytics, and A/B test integration.
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore } = require("../models/store");
const { sanitizeText, sanitizeMultilineText } = require("../utils/workspace-config");
const { getActiveTest, pickVariant, recordSent, createAbTest } = require("./ab-testing.service");

// ─── Campaign CRUD ─────────────────────────────────────────────────────────

function ensureCampaigns(workspace) {
  if (!Array.isArray(workspace.campaigns)) workspace.campaigns = [];
}

function ensureTemplates(workspace) {
  if (!Array.isArray(workspace.templates)) workspace.templates = [];
}

function createCampaign(workspace, data) {
  ensureCampaigns(workspace);
  const now = new Date().toISOString();
  const campaign = {
    id: `camp_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`,
    name: sanitizeText(data.name, "Untitled Campaign"),
    messages: Array.isArray(data.messages)
      ? data.messages.map((m) => sanitizeMultilineText(m, "")).filter(Boolean)
      : [],
    mediaId: sanitizeText(data.mediaId, ""),
    // Audience targeting
    audience: normalizeAudience(data.audience),
    // A/B test
    abTestEnabled: Boolean(data.abTestEnabled),
    abTestId: "",
    // Scheduling
    sendAt: sanitizeText(data.sendAt, ""),
    // Send options
    mode: sanitizeText(data.mode, "instant"),
    delayMs: Number(data.delayMs) || 0,
    randomMinMs: Number(data.randomMinMs) || 0,
    randomMaxMs: Number(data.randomMaxMs) || 0,
    templateMode: sanitizeText(data.templateMode, ""),
    templateLines: sanitizeText(data.templateLines, ""),
    // Status & analytics
    status: "draft", // draft | scheduled | sending | completed | cancelled
    stats: { total: 0, delivered: 0, failed: 0, replied: 0, optedOut: 0 },
    createdAt: now,
    sentAt: "",
    completedAt: "",
  };
  workspace.campaigns.push(campaign);
  saveStore();
  return campaign;
}

function getCampaign(workspace, campaignId) {
  ensureCampaigns(workspace);
  return workspace.campaigns.find((c) => c.id === campaignId) || null;
}

function listCampaigns(workspace) {
  ensureCampaigns(workspace);
  return workspace.campaigns.slice().reverse();
}

function updateCampaign(workspace, campaignId, updates) {
  const campaign = getCampaign(workspace, campaignId);
  if (!campaign) return null;
  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    throw new Error("Cannot edit a campaign that is already sending or completed.");
  }
  if (updates.name !== undefined) campaign.name = sanitizeText(updates.name, campaign.name);
  if (updates.messages !== undefined) {
    campaign.messages = Array.isArray(updates.messages)
      ? updates.messages.map((m) => sanitizeMultilineText(m, "")).filter(Boolean)
      : campaign.messages;
  }
  if (updates.mediaId !== undefined) campaign.mediaId = sanitizeText(updates.mediaId, "");
  if (updates.audience !== undefined) campaign.audience = normalizeAudience(updates.audience);
  if (updates.abTestEnabled !== undefined) campaign.abTestEnabled = Boolean(updates.abTestEnabled);
  if (updates.sendAt !== undefined) campaign.sendAt = sanitizeText(updates.sendAt, "");
  if (updates.mode !== undefined) campaign.mode = sanitizeText(updates.mode, "instant");
  if (updates.delayMs !== undefined) campaign.delayMs = Number(updates.delayMs) || 0;
  saveStore();
  return campaign;
}

function deleteCampaign(workspace, campaignId) {
  ensureCampaigns(workspace);
  const idx = workspace.campaigns.findIndex((c) => c.id === campaignId);
  if (idx === -1) return false;
  const campaign = workspace.campaigns[idx];
  if (campaign.status === "sending") throw new Error("Cannot delete a campaign that is currently sending.");
  workspace.campaigns.splice(idx, 1);
  saveStore();
  return true;
}

function cloneCampaign(workspace, campaignId) {
  const source = getCampaign(workspace, campaignId);
  if (!source) return null;
  return createCampaign(workspace, {
    name: `${source.name} (copy)`,
    messages: [...source.messages],
    mediaId: source.mediaId,
    audience: source.audience,
    abTestEnabled: source.abTestEnabled,
    mode: source.mode,
    delayMs: source.delayMs,
    randomMinMs: source.randomMinMs,
    randomMaxMs: source.randomMaxMs,
    templateMode: source.templateMode,
    templateLines: source.templateLines,
  });
}

// ─── Audience Targeting ────────────────────────────────────────────────────

function normalizeAudience(raw) {
  if (!raw || typeof raw !== "object") {
    return { type: "all" }; // send to all recipients
  }
  const audience = { type: sanitizeText(raw.type, "all") };
  if (audience.type === "segment") {
    audience.filters = {
      statuses: Array.isArray(raw.filters?.statuses) ? raw.filters.statuses : [],
      stages: Array.isArray(raw.filters?.stages) ? raw.filters.stages : [],
      tags: Array.isArray(raw.filters?.tags) ? raw.filters.tags : [],
      scoreMin: Number.isFinite(Number(raw.filters?.scoreMin)) ? Number(raw.filters.scoreMin) : 0,
      scoreMax: Number.isFinite(Number(raw.filters?.scoreMax)) ? Number(raw.filters.scoreMax) : 100,
      lastContactDays: Number(raw.filters?.lastContactDays) || 0, // 0 = no filter
    };
  } else if (audience.type === "specific") {
    audience.recipients = Array.isArray(raw.recipients) ? raw.recipients : [];
  }
  return audience;
}

/**
 * Resolve campaign audience to a list of chatIds.
 * @returns {string[]} chatIds to send to
 */
function resolveAudience(workspace, campaign) {
  const { normalizeRecipients } = require("../utils/workspace-config");
  const allRecipients = normalizeRecipients(workspace.config.RECIPIENTS || "").map((n) => `${n}@c.us`);

  if (!campaign.audience || campaign.audience.type === "all") {
    return allRecipients;
  }

  if (campaign.audience.type === "specific") {
    const specific = (campaign.audience.recipients || []).map((n) => `${n}@c.us`);
    return specific.filter((id) => allRecipients.includes(id));
  }

  if (campaign.audience.type === "segment") {
    const filters = campaign.audience.filters || {};
    const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
    const leadsById = new Map(leads.map((l) => [l.id, l]));

    return allRecipients.filter((chatId) => {
      const lead = leadsById.get(chatId);
      if (!lead) {
        // If no lead record, only include if no filters are set
        return (
          (filters.statuses || []).length === 0 &&
          (filters.stages || []).length === 0 &&
          (filters.tags || []).length === 0
        );
      }

      // Status filter
      if (filters.statuses?.length > 0 && !filters.statuses.includes(lead.status)) return false;
      // Stage filter
      if (filters.stages?.length > 0 && !filters.stages.includes(lead.stage)) return false;
      // Tag filter
      if (filters.tags?.length > 0) {
        const leadTags = Array.isArray(lead.tags) ? lead.tags : [];
        if (!filters.tags.some((t) => leadTags.includes(t))) return false;
      }
      // Score range
      const score = lead.score || 0;
      if (score < (filters.scoreMin || 0)) return false;
      if (score > (filters.scoreMax || 100)) return false;
      // Last contact days
      if (filters.lastContactDays > 0) {
        const lastContact = lead.lastInboundAt || lead.lastOutboundAt || lead.updatedAt;
        if (lastContact) {
          const daysSince = (Date.now() - new Date(lastContact).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSince < filters.lastContactDays) return false;
        }
      }
      return true;
    });
  }

  return allRecipients;
}

// ─── Personalization ───────────────────────────────────────────────────────

/**
 * Replace {name}, {first_name}, {status}, {score} placeholders in message text.
 */
function personalizeMessage(text, chatId, workspace) {
  if (!text || typeof text !== "string") return text;
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const lead = leads.find((l) => l.id === chatId);
  const name = lead?.name || chatId.split("@")[0];
  const firstName = name.split(/\s+/)[0];

  return text
    .replace(/\{name\}/gi, name)
    .replace(/\{first_name\}/gi, firstName)
    .replace(/\{status\}/gi, lead?.status || "")
    .replace(/\{score\}/gi, String(lead?.score || 0))
    .replace(/\{stage\}/gi, lead?.stage || "");
}

// ─── Campaign Analytics Tracking ───────────────────────────────────────────

function recordCampaignSend(workspace, campaignId, chatId, ok) {
  const campaign = getCampaign(workspace, campaignId);
  if (!campaign) return;
  campaign.stats.total += 1;
  if (ok) campaign.stats.delivered += 1;
  else campaign.stats.failed += 1;
}

function recordCampaignReply(workspace, campaignId) {
  const campaign = getCampaign(workspace, campaignId);
  if (!campaign) return;
  campaign.stats.replied += 1;
}

function completeCampaign(workspace, campaignId) {
  const campaign = getCampaign(workspace, campaignId);
  if (!campaign) return;
  campaign.status = "completed";
  campaign.completedAt = new Date().toISOString();
  saveStore();
}

// ─── Template Library ──────────────────────────────────────────────────────

function createTemplate(workspace, data) {
  ensureTemplates(workspace);
  const template = {
    id: `tpl_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`,
    name: sanitizeText(data.name, "Untitled Template"),
    category: sanitizeText(data.category, "general"),
    messages: Array.isArray(data.messages)
      ? data.messages.map((m) => sanitizeMultilineText(m, "")).filter(Boolean)
      : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  workspace.templates.push(template);
  saveStore();
  return template;
}

function listTemplates(workspace) {
  ensureTemplates(workspace);
  return workspace.templates.slice().reverse();
}

function getTemplate(workspace, templateId) {
  ensureTemplates(workspace);
  return workspace.templates.find((t) => t.id === templateId) || null;
}

function updateTemplate(workspace, templateId, updates) {
  const template = getTemplate(workspace, templateId);
  if (!template) return null;
  if (updates.name !== undefined) template.name = sanitizeText(updates.name, template.name);
  if (updates.category !== undefined) template.category = sanitizeText(updates.category, template.category);
  if (updates.messages !== undefined) {
    template.messages = Array.isArray(updates.messages)
      ? updates.messages.map((m) => sanitizeMultilineText(m, "")).filter(Boolean)
      : template.messages;
  }
  template.updatedAt = new Date().toISOString();
  saveStore();
  return template;
}

function deleteTemplate(workspace, templateId) {
  ensureTemplates(workspace);
  const idx = workspace.templates.findIndex((t) => t.id === templateId);
  if (idx === -1) return false;
  workspace.templates.splice(idx, 1);
  saveStore();
  return true;
}

// ─── A/B Integration Helper ───────────────────────────────────────────────

function setupCampaignAbTest(workspace, campaign) {
  if (!campaign.abTestEnabled || campaign.messages.length < 2) return null;
  const test = createAbTest(workspace, `AB: ${campaign.name}`, campaign.messages);
  campaign.abTestId = test.id;
  saveStore();
  return test;
}

function pickAbVariantForRecipient(workspace, campaign, chatId) {
  if (!campaign.abTestId) return null;
  const tests = Array.isArray(workspace.abTests) ? workspace.abTests : [];
  const test = tests.find((t) => t.id === campaign.abTestId);
  if (!test || test.status !== "running") return null;

  const variant = pickVariant(test);
  if (!variant) return null;

  // Track which variant was sent to this lead
  if (!test.lastSentVariant) test.lastSentVariant = {};
  test.lastSentVariant[chatId] = variant.id;
  recordSent(workspace, test.id, variant.id);
  return variant;
}

module.exports = {
  // Campaign CRUD
  ensureCampaigns,
  createCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
  deleteCampaign,
  cloneCampaign,
  // Audience
  normalizeAudience,
  resolveAudience,
  // Personalization
  personalizeMessage,
  // Analytics
  recordCampaignSend,
  recordCampaignReply,
  completeCampaign,
  // Templates
  ensureTemplates,
  createTemplate,
  listTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  // A/B
  setupCampaignAbTest,
  pickAbVariantForRecipient,
};
