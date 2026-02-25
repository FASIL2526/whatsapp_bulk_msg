/* ─── Nurture Drip Service ──────────────────────────────────────────────────
 *  Autonomous multi-day lead nurture sequences that adapt based on replies.
 *  Each workspace can define drip sequences; the sweep runs every 60s.
 * ─────────────────────────────────────────────────────────────────────────── */

const { DEFAULT_CONFIG } = require("../config/default-config");
const { sanitizeText } = require("../utils/workspace-config");
const { store, saveStore, getRuntime, appendReport } = require("../models/store");

const DEFAULT_DRIP_STEPS = [
  { delayDays: 0,  message: "Hi {{name}}! I noticed you showed interest. Happy to answer any questions about how we can help." },
  { delayDays: 1,  message: "Quick thought, {{name}}: most of our clients see results within the first week. Want me to walk you through how?" },
  { delayDays: 3,  message: "Hey {{name}}, I put together a quick summary of what we solve. Would a 5-min overview help?" },
  { delayDays: 5,  message: "{{name}}, we have a limited-time offer running this week. Want me to share the details?" },
  { delayDays: 7,  message: "Last check-in, {{name}} — still open to exploring this? No pressure either way." },
];

function getDripSteps(workspace) {
  try {
    const raw = workspace.config?.NURTURE_DRIP_STEPS;
    if (raw && typeof raw === "string" && raw.trim().startsWith("[")) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) { /* use defaults */ }
  return DEFAULT_DRIP_STEPS;
}

function personalizeMessage(template, lead) {
  const name = lead.name || lead.id?.split("@")[0] || "there";
  return template.replace(/\{\{name\}\}/gi, name);
}

async function processWorkspaceNurtureDrip(workspace) {
  if (workspace.config?.NURTURE_DRIP_ENABLED !== "true") return false;
  const runtime = getRuntime(workspace.id);
  if (!runtime.client || !runtime.ready) return false;

  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  if (leads.length === 0) return false;

  const steps = getDripSteps(workspace);
  const now = Date.now();
  let changed = false;

  for (const lead of leads) {
    if (!lead.id || lead.stage === "closed_won" || lead.stage === "closed_lost") continue;
    // Only drip leads that haven't replied recently (cold/warm, not actively engaged)
    if (lead.lastInboundAt) {
      const lastReply = new Date(lead.lastInboundAt).getTime();
      // If lead replied in the last 24h, skip drip — they're in active conversation
      if (now - lastReply < 24 * 60 * 60 * 1000) continue;
    }

    const dripStartedAt = lead.dripStartedAt ? new Date(lead.dripStartedAt).getTime() : 0;
    if (!dripStartedAt) continue; // Lead not enrolled in drip

    const currentStep = lead.dripStep || 0;
    if (currentStep >= steps.length) continue; // Drip complete

    const step = steps[currentStep];
    const dueAt = dripStartedAt + (step.delayDays || 0) * 24 * 60 * 60 * 1000;
    if (now < dueAt) continue; // Not time yet

    const text = personalizeMessage(step.message, lead);
    try {
      await runtime.client.sendMessage(lead.id, text);
      lead.dripStep = currentStep + 1;
      lead.lastOutboundAt = new Date().toISOString();
      lead.updatedAt = new Date().toISOString();
      appendReport(workspace, {
        kind: "nurture_drip",
        source: "drip_autopilot",
        ok: true,
        from: lead.id,
        message: text,
        step: currentStep,
      });
      changed = true;
    } catch (err) {
      appendReport(workspace, {
        kind: "nurture_drip",
        source: "drip_autopilot",
        ok: false,
        from: lead.id,
        message: text,
        error: err.message,
      });
    }
  }
  return changed;
}

async function processNurtureDrip() {
  try {
    let changed = false;
    for (const ws of store.workspaces) {
      const updated = await processWorkspaceNurtureDrip(ws);
      changed = changed || updated;
    }
    if (changed) saveStore();
  } catch (err) {
    console.error(`[ERROR] processNurtureDrip: ${err.message}`);
  }
}

/** Enroll a lead into the drip sequence */
function enrollLeadInDrip(workspace, leadId) {
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const lead = leads.find((l) => l.id === leadId);
  if (!lead) return false;
  if (lead.dripStartedAt) return false; // already enrolled
  lead.dripStartedAt = new Date().toISOString();
  lead.dripStep = 0;
  lead.updatedAt = new Date().toISOString();
  saveStore();
  return true;
}

function unenrollLeadFromDrip(workspace, leadId) {
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const lead = leads.find((l) => l.id === leadId);
  if (!lead) return false;
  lead.dripStartedAt = "";
  lead.dripStep = 0;
  lead.updatedAt = new Date().toISOString();
  saveStore();
  return true;
}

module.exports = {
  processNurtureDrip,
  processWorkspaceNurtureDrip,
  enrollLeadInDrip,
  unenrollLeadFromDrip,
  getDripSteps,
  DEFAULT_DRIP_STEPS,
};
