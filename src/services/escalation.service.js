/* ─── Escalation Service ────────────────────────────────────────────────────
 *  Detects when AI is stuck, lead is angry, or deal is high-value,
 *  and auto-notifies a human operator with context summary.
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore, getRuntime, appendReport } = require("../models/store");
const { sanitizeText } = require("../utils/workspace-config");
const { queueAlert } = require("./whatsapp-alerts.service");
const { getConversationHistory, formatHistoryForPrompt } = require("./conversation-memory");

const NEGATIVE_SIGNALS = [
  "angry", "frustrated", "terrible", "worst", "scam", "fraud",
  "lawsuit", "sue", "report", "complaint", "horrible", "disgusting",
  "hate", "never", "refund", "cancel", "unsubscribe",
];

function detectEscalationNeed(lead, workspace) {
  const reasons = [];
  const score = lead.score || 0;
  const status = lead.status || "cold";

  // High-value lead stuck without progress
  if (score >= 70 && (lead.stage === "proposal" || lead.stage === "qualified")) {
    const lastUpdate = new Date(lead.updatedAt || 0).getTime();
    if (Date.now() - lastUpdate > 48 * 60 * 60 * 1000) {
      reasons.push("high_value_stalled");
    }
  }

  // Negative sentiment detection
  const lastMsg = (lead.lastMessage || "").toLowerCase();
  const negativeHits = NEGATIVE_SIGNALS.filter((w) => lastMsg.includes(w));
  if (negativeHits.length >= 1) {
    reasons.push(`negative_sentiment: ${negativeHits.join(", ")}`);
  }

  // Too many follow-ups without reply
  if ((lead.followUpCount || 0) >= 3 && status !== "cold") {
    reasons.push("max_followups_no_reply");
  }

  // Lead explicitly asked for human
  const humanKeywords = ["speak to a person", "talk to someone", "human", "real person", "agent", "manager", "supervisor"];
  if (humanKeywords.some((kw) => lastMsg.includes(kw))) {
    reasons.push("human_requested");
  }

  return reasons;
}

function buildEscalationSummary(lead, workspace) {
  const history = getConversationHistory(workspace.id, lead.id);
  const historyText = history.length > 0
    ? history.slice(-6).map((h) => `${h.role === "user" ? "Lead" : "Bot"}: ${h.content}`).join("\n")
    : "(no history)";

  return [
    `🚨 ESCALATION ALERT — ${workspace.name || workspace.id}`,
    `Lead: ${lead.name || lead.id}`,
    `Score: ${lead.score || 0} | Status: ${lead.status || "unknown"} | Stage: ${lead.stage || "new"}`,
    `Objection: ${lead.primaryObjection || "none"}`,
    `Follow-ups sent: ${lead.followUpCount || 0}`,
    `Last message: "${(lead.lastMessage || "").slice(0, 200)}"`,
    ``,
    `Recent conversation:`,
    historyText,
  ].join("\n");
}

async function processWorkspaceEscalations(workspace) {
  if (workspace.config?.AUTO_ESCALATION_ENABLED !== "true") return false;
  const runtime = getRuntime(workspace.id);
  if (!runtime.client || !runtime.ready) return false;

  const operatorNumber = sanitizeText(workspace.config?.AUTO_ESCALATION_OPERATOR, "");
  if (!operatorNumber) return false;
  const operatorChatId = operatorNumber.includes("@") ? operatorNumber : `${operatorNumber}@c.us`;

  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  let changed = false;

  for (const lead of leads) {
    if (!lead.id || lead.stage === "closed_won" || lead.stage === "closed_lost") continue;
    if (lead.escalatedAt) continue; // Already escalated

    const reasons = detectEscalationNeed(lead, workspace);
    if (reasons.length === 0) continue;

    const summary = buildEscalationSummary(lead, workspace);
    try {
      await runtime.client.sendMessage(operatorChatId, summary);
      lead.escalatedAt = new Date().toISOString();
      lead.escalationReasons = reasons;
      lead.updatedAt = new Date().toISOString();
      appendReport(workspace, {
        kind: "auto_escalation",
        source: "escalation_autopilot",
        ok: true,
        from: lead.id,
        message: `Escalated: ${reasons.join(", ")}`,
      });
      queueAlert(workspace.id, "escalation", {
        leadName: lead.name || lead.id?.split("@")[0],
        leadId: lead.id,
        score: lead.score,
        status: lead.status,
        stage: lead.stage,
        reason: `Escalation: ${reasons.join(", ")}`,
      });
      changed = true;
    } catch (err) {
      appendReport(workspace, {
        kind: "auto_escalation",
        source: "escalation_autopilot",
        ok: false,
        from: lead.id,
        error: err.message,
      });
    }
  }
  return changed;
}

async function processEscalations() {
  try {
    let changed = false;
    for (const ws of store.workspaces) {
      const updated = await processWorkspaceEscalations(ws);
      changed = changed || updated;
    }
    if (changed) saveStore();
  } catch (err) {
    console.error(`[ERROR] processEscalations: ${err.message}`);
  }
}

module.exports = { processEscalations, processWorkspaceEscalations, detectEscalationNeed };
