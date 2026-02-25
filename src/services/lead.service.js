/* ─── Lead Service ─────────────────────────────────────────────────────────
 *  Lead status tracking, follow-up building & processing.
 * ─────────────────────────────────────────────────────────────────────────── */

const { DEFAULT_CONFIG } = require("../config/default-config");
const { sanitizeText, sanitizeChoice } = require("../utils/workspace-config");
const { parseList } = require("../utils/helpers");
const {
  store,
  saveStore,
  getRuntime,
  appendReport,
  getFollowUpSweepInProgress,
  setFollowUpSweepInProgress,
} = require("../models/store");
const { shouldAskCloseQuestion } = require("./ai.service");
const { queueAlert } = require("./whatsapp-alerts.service");

// ─── Lead CRUD ─────────────────────────────────────────────────────────────
function updateLeadStatus(workspace, leadData) {
  try {
    if (!workspace.leads) workspace.leads = [];
    const contactId = leadData.from;
    let lead = workspace.leads.find((l) => l.id === contactId);
    const isNewLead = !lead;
    const prevStatus = lead?.status;
    const prevStage  = lead?.stage;

    if (!lead) {
      lead = {
        id: contactId,
        name: leadData.name || contactId.split("@")[0],
        status: "cold",
        reason: "Initial contact",
        stage: "new",
        score: 0,
        lastMessage: "",
        qualification: { need: "", budget: "", timeline: "", decision_maker: "" },
        missingQualificationFields: ["need", "budget", "timeline", "decision_maker"],
        primaryObjection: "",
        followUpCount: 0,
        nextFollowUpAt: "",
        lastInboundAt: "",
        lastOutboundAt: "",
        updatedAt: new Date().toISOString(),
      };
      workspace.leads.push(lead);
    }

    if (leadData.status) lead.status = leadData.status;
    if (leadData.reason) lead.reason = leadData.reason;
    if (leadData.stage) lead.stage = leadData.stage;
    if (Number.isFinite(leadData.score))
      lead.score = Math.min(100, Math.max(0, Math.round(leadData.score)));
    if (leadData.message) lead.lastMessage = leadData.message;
    if (leadData.qualification && typeof leadData.qualification === "object") {
      lead.qualification = {
        need: sanitizeText(leadData.qualification.need, lead.qualification?.need || ""),
        budget: sanitizeText(leadData.qualification.budget, lead.qualification?.budget || ""),
        timeline: sanitizeText(leadData.qualification.timeline, lead.qualification?.timeline || ""),
        decision_maker: sanitizeText(
          leadData.qualification.decision_maker,
          lead.qualification?.decision_maker || ""
        ),
      };
    }
    if (Array.isArray(leadData.missingQualificationFields)) {
      lead.missingQualificationFields = leadData.missingQualificationFields
        .map((f) => sanitizeText(f, "").toLowerCase())
        .filter(Boolean);
    }
    if (leadData.primaryObjection !== undefined)
      lead.primaryObjection = sanitizeText(leadData.primaryObjection, lead.primaryObjection || "");
    if (leadData.lastInboundAt !== undefined)
      lead.lastInboundAt = sanitizeText(leadData.lastInboundAt, lead.lastInboundAt || "");
    if (leadData.lastOutboundAt !== undefined)
      lead.lastOutboundAt = sanitizeText(leadData.lastOutboundAt, lead.lastOutboundAt || "");
    if (leadData.nextFollowUpAt !== undefined)
      lead.nextFollowUpAt = sanitizeText(leadData.nextFollowUpAt, lead.nextFollowUpAt || "");
    if (leadData.followUpCount !== undefined && Number.isFinite(Number(leadData.followUpCount)))
      lead.followUpCount = Math.max(0, Number.parseInt(String(leadData.followUpCount), 10) || 0);

    lead.updatedAt = new Date().toISOString();
    saveStore();

    // ── WhatsApp Alerts ──
    const alertData = { leadName: lead.name, leadId: lead.id, score: lead.score, status: lead.status, stage: lead.stage, message: lead.lastMessage };
    if (isNewLead) {
      queueAlert(workspace.id, "new_lead", alertData);
    }
    if (lead.status === "hot" && prevStatus !== "hot") {
      queueAlert(workspace.id, "hot_lead", alertData);
    }
    if (lead.stage === "closed_won" && prevStage !== "closed_won") {
      queueAlert(workspace.id, "closed_won", { ...alertData, reason: "Deal closed won! 🎉" });
    }
    if (lead.stage === "closed_lost" && prevStage !== "closed_lost") {
      queueAlert(workspace.id, "closed_lost", { ...alertData, reason: lead.reason || "Deal lost" });
    }
  } catch (err) {
    console.error(`[ERROR] updateLeadStatus: ${err.message}`);
  }
}

// ─── Follow-up helpers ─────────────────────────────────────────────────────
function nextFollowUpAt(config, fromDate = new Date()) {
  if (config.AI_FOLLOW_UP_ENABLED !== "true") return "";
  const delayMinutes = Math.max(
    5,
    Number.parseInt(config.AI_FOLLOW_UP_DELAY_MINUTES || "180", 10) || 180
  );
  return new Date(fromDate.getTime() + delayMinutes * 60 * 1000).toISOString();
}

function buildFollowUpMessage(workspace, lead) {
  const template = sanitizeText(
    workspace.config.AI_FOLLOW_UP_TEMPLATE,
    DEFAULT_CONFIG.AI_FOLLOW_UP_TEMPLATE
  );
  const bookingLink = sanitizeText(workspace.config.AI_BOOKING_LINK, "");
  const includeStory = workspace.config.AI_AUTO_STORY_TO_CLOSE === "true";
  const story = sanitizeText(workspace.config.AI_CLOSING_STORY, "");
  const includeStatusFeatures = workspace.config.AI_WHATSAPP_STATUS_FEATURES === "true";
  const statusFeaturesText = sanitizeText(
    workspace.config.AI_WHATSAPP_STATUS_FEATURES_TEXT,
    DEFAULT_CONFIG.AI_WHATSAPP_STATUS_FEATURES_TEXT
  );
  const closeQuestion = bookingLink
    ? `Would you like to book a quick call here: ${bookingLink}?`
    : "Would you like me to prepare the next step for you now?";

  const parts = [template];
  if (includeStory && story) parts.push(story);
  if (includeStatusFeatures && statusFeaturesText) parts.push(statusFeaturesText);
  if (shouldAskCloseQuestion(workspace.config, lead.status, lead.score || 0, false))
    parts.push(closeQuestion);
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

async function processWorkspaceAutoFollowUps(workspace) {
  const config = workspace.config || DEFAULT_CONFIG;
  if (config.AI_FOLLOW_UP_ENABLED !== "true") return false;
  const runtime = getRuntime(workspace.id);
  if (!runtime.client || !runtime.ready) return false;

  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  if (leads.length === 0) return false;

  const maxAttempts = Math.max(
    1,
    Number.parseInt(config.AI_FOLLOW_UP_MAX_ATTEMPTS || "3", 10) || 3
  );
  let changed = false;
  const now = new Date();

  for (const lead of leads) {
    const leadId = String(lead?.id || "");
    if (!leadId) continue;
    if (leadId.endsWith("@g.us") && config.AI_SALES_GROUPS !== "true") continue;
    if (lead.stage === "closed_won" || lead.stage === "closed_lost") continue;
    if ((lead.status || "cold") === "cold") continue;

    const dueAt = new Date(lead.nextFollowUpAt || "");
    if (Number.isNaN(dueAt.getTime()) || dueAt > now) continue;

    const attempts = Number.parseInt(String(lead.followUpCount || 0), 10) || 0;
    if (attempts >= maxAttempts) {
      lead.nextFollowUpAt = "";
      changed = true;
      continue;
    }
    if (lead.lastInboundAt && lead.lastOutboundAt) {
      const inboundAt = new Date(lead.lastInboundAt);
      const outboundAt = new Date(lead.lastOutboundAt);
      if (
        !Number.isNaN(inboundAt.getTime()) &&
        !Number.isNaN(outboundAt.getTime()) &&
        inboundAt > outboundAt
      ) {
        lead.nextFollowUpAt = "";
        changed = true;
        continue;
      }
    }

    const followUpText = buildFollowUpMessage(workspace, lead);
    if (!followUpText) continue;

    try {
      await runtime.client.sendMessage(leadId, followUpText);
      lead.followUpCount = attempts + 1;
      lead.lastOutboundAt = new Date().toISOString();
      lead.nextFollowUpAt = lead.followUpCount < maxAttempts ? nextFollowUpAt(config) : "";
      lead.updatedAt = new Date().toISOString();
      appendReport(workspace, {
        kind: "auto_follow_up",
        source: "ai_follow_up",
        ok: true,
        from: leadId,
        message: followUpText,
      });
      changed = true;
    } catch (err) {
      appendReport(workspace, {
        kind: "auto_follow_up",
        source: "ai_follow_up",
        ok: false,
        from: leadId,
        message: followUpText,
        error: err.message,
      });
      runtime.lastError = `Follow-up failed (${leadId}): ${err.message}`;
    }
  }
  return changed;
}

async function processAutoFollowUps() {
  if (getFollowUpSweepInProgress()) return;
  setFollowUpSweepInProgress(true);
  try {
    let changed = false;
    for (const workspace of store.workspaces) {
      const updated = await processWorkspaceAutoFollowUps(workspace);
      changed = changed || updated;
    }
    if (changed) saveStore();
  } catch (err) {
    console.error(`[ERROR] processAutoFollowUps: ${err.message}`);
  } finally {
    setFollowUpSweepInProgress(false);
  }
}

module.exports = {
  updateLeadStatus,
  nextFollowUpAt,
  buildFollowUpMessage,
  processWorkspaceAutoFollowUps,
  processAutoFollowUps,
};
