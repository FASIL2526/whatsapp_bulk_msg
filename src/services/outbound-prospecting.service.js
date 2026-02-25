/* ─── Outbound Prospecting Service ──────────────────────────────────────────
 *  Autonomous outbound: decides which leads to message first,
 *  picks the highest-opportunity leads, and initiates conversations.
 *  Runs on a sweep interval — no human trigger required.
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore, getRuntime, appendReport } = require("../models/store");
const { DEFAULT_CONFIG } = require("../config/default-config");
const { sanitizeText } = require("../utils/workspace-config");
const {
  getConversationHistory,
  pushToConversationHistory,
} = require("./conversation-memory");

// ─── Opportunity scoring ───────────────────────────────────────────────────
// Ranks leads by "how likely is outbound to convert right now?"
function opportunityScore(lead) {
  let score = 0;
  const status = (lead.status || "cold").toLowerCase();
  const stage = (lead.stage || "new").toLowerCase();

  // Status weight
  if (status === "hot") score += 40;
  else if (status === "warm") score += 25;
  else score += 10;

  // Lead score weight
  score += Math.min(30, Math.round((lead.score || 0) * 0.3));

  // Qualification completeness
  const q = lead.qualification || {};
  const filled = ["need", "budget", "timeline", "decision_maker"]
    .filter(f => String(q[f] || "").trim().length > 0).length;
  score += filled * 5; // up to 20

  // Recency bonus: more recent = higher opportunity
  const lastInbound = new Date(lead.lastInboundAt || 0);
  const hoursSinceInbound = (Date.now() - lastInbound.getTime()) / (1000 * 60 * 60);
  if (hoursSinceInbound < 2) score += 15;
  else if (hoursSinceInbound < 6) score += 10;
  else if (hoursSinceInbound < 24) score += 5;

  // Penalise over-contacted leads
  const followUpCount = Number(lead.followUpCount || 0);
  if (followUpCount >= 3) score -= 15;
  else if (followUpCount >= 2) score -= 8;

  // Penalise closed / archived
  if (stage === "closed_won" || stage === "closed_lost") score -= 100;
  if (lead.archived) score -= 100;

  // Bonus for tags that signal readiness
  const tags = Array.isArray(lead.tags) ? lead.tags : [];
  if (tags.includes("ready-to-buy")) score += 15;
  if (tags.includes("decision-maker")) score += 10;
  if (tags.includes("high-intent")) score += 10;
  if (tags.includes("enterprise")) score += 5;

  return Math.max(0, score);
}

// ─── Candidate filtering ──────────────────────────────────────────────────
function getOutboundCandidates(workspace) {
  const config = workspace.config || DEFAULT_CONFIG;
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const cooldownHours = Math.max(1, Number(config.OUTBOUND_COOLDOWN_HOURS || "6"));
  const maxDailyOutbound = Math.max(1, Number(config.OUTBOUND_MAX_DAILY || "20"));
  const now = Date.now();

  // Count how many outbound messages we've sent today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaySent = (workspace._outboundLog || [])
    .filter(e => new Date(e.at) >= todayStart).length;
  if (todaySent >= maxDailyOutbound) return [];

  const remaining = maxDailyOutbound - todaySent;

  const candidates = leads
    .filter(l => {
      // Skip closed / archived
      if (l.stage === "closed_won" || l.stage === "closed_lost" || l.archived) return false;
      // Skip leads we messaged within cooldown
      const lastOut = new Date(l.lastOutboundAt || 0).getTime();
      if (now - lastOut < cooldownHours * 60 * 60 * 1000) return false;
      // Skip leads who replied within last 1h (they're already engaged)
      const lastIn = new Date(l.lastInboundAt || 0).getTime();
      if (now - lastIn < 60 * 60 * 1000) return false;
      // Must have a valid chat id
      if (!l.id || !l.id.includes("@")) return false;
      return true;
    })
    .map(l => ({ lead: l, oppScore: opportunityScore(l) }))
    .filter(x => x.oppScore > 20) // minimum threshold
    .sort((a, b) => b.oppScore - a.oppScore)
    .slice(0, remaining);

  return candidates;
}

// ─── Outbound message builder ──────────────────────────────────────────────
function buildOutboundMessage(workspace, lead) {
  const config = workspace.config || DEFAULT_CONFIG;
  const name = lead.name || lead.id?.split("@")[0] || "there";
  const knowledge = sanitizeText(config.AI_PRODUCT_KNOWLEDGE, DEFAULT_CONFIG.AI_PRODUCT_KNOWLEDGE);
  const status = (lead.status || "cold").toLowerCase();
  const stage = (lead.stage || "new").toLowerCase();
  const score = lead.score || 0;
  const primaryObjection = sanitizeText(lead.primaryObjection, "");
  const bookingLink = sanitizeText(config.AI_BOOKING_LINK, "");

  // Custom outbound template if set
  const customTemplate = sanitizeText(config.OUTBOUND_TEMPLATE, "");
  if (customTemplate) {
    return customTemplate
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{score\}\}/g, String(score))
      .replace(/\{\{status\}\}/g, status)
      .replace(/\{\{booking_link\}\}/g, bookingLink);
  }

  // Intelligent message selection based on lead state
  if (status === "hot" && score >= 70) {
    if (bookingLink) {
      return `Hey ${name}! Following up — I think you're close to getting started. Want to lock in a quick call? ${bookingLink}`;
    }
    return `Hey ${name}! Just checking in — you seemed really interested. Want me to prepare the next step for you?`;
  }

  if (status === "warm" || score >= 45) {
    if (primaryObjection) {
      return `Hi ${name}, quick thought regarding your concern about "${primaryObjection}" — I have some info that might help. Mind if I share?`;
    }
    return `Hi ${name}! I was thinking about your situation and had an idea that could help. Got a minute?`;
  }

  // Cold / new leads — value-first approach
  const valueProps = [
    `Hey ${name}! Quick question — are you currently looking to improve your ${knowledge.split(" ").slice(0, 5).join(" ")}?`,
    `Hi ${name}! Saw you had some interest earlier — I've helped similar businesses solve this. Worth a quick chat?`,
    `Hey ${name}, just sharing something that might be useful: ${knowledge.slice(0, 100)}. Interested in learning more?`,
  ];
  return valueProps[Math.floor(Math.random() * valueProps.length)];
}

// ─── Main sweep ────────────────────────────────────────────────────────────
let _sweepInProgress = false;

async function processOutboundProspecting() {
  if (_sweepInProgress) return;
  _sweepInProgress = true;
  try {
    for (const workspace of store.workspaces) {
      await processWorkspaceOutbound(workspace);
    }
  } catch (err) {
    console.error(`[ERROR] processOutboundProspecting: ${err.message}`);
  } finally {
    _sweepInProgress = false;
  }
}

async function processWorkspaceOutbound(workspace) {
  const config = workspace.config || DEFAULT_CONFIG;
  if (config.OUTBOUND_PROSPECTING_ENABLED !== "true") return;

  const runtime = getRuntime(workspace.id);
  if (!runtime.client || !runtime.ready) return;

  if (!workspace._outboundLog) workspace._outboundLog = [];

  const candidates = getOutboundCandidates(workspace);
  if (candidates.length === 0) return;

  let changed = false;
  for (const { lead, oppScore } of candidates) {
    const message = buildOutboundMessage(workspace, lead);
    if (!message) continue;

    try {
      await runtime.client.sendMessage(lead.id, message);

      lead.lastOutboundAt = new Date().toISOString();
      lead.updatedAt = new Date().toISOString();
      lead.followUpCount = (lead.followUpCount || 0) + 1;
      workspace._outboundLog.push({ at: new Date().toISOString(), leadId: lead.id, oppScore });

      // Keep memory in sync
      pushToConversationHistory(
        workspace.id, lead.id, "assistant", message,
        Number(config.AI_MEMORY_TURNS || "10") || 10
      );

      appendReport(workspace, {
        kind: "outbound_prospect",
        source: "outbound_autopilot",
        ok: true,
        from: lead.id,
        message,
        oppScore,
      });
      changed = true;
    } catch (err) {
      appendReport(workspace, {
        kind: "outbound_prospect",
        source: "outbound_autopilot",
        ok: false,
        from: lead.id,
        message,
        error: err.message,
      });
    }
  }

  // Trim outbound log to last 7 days
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  workspace._outboundLog = workspace._outboundLog.filter(e => new Date(e.at) >= weekAgo);

  if (changed) saveStore();
}

// ─── API helpers ───────────────────────────────────────────────────────────
function getOutboundQueue(workspace) {
  const candidates = getOutboundCandidates(workspace);
  return candidates.map(({ lead, oppScore }) => ({
    id: lead.id,
    name: lead.name || lead.id?.split("@")[0],
    status: lead.status,
    stage: lead.stage,
    score: lead.score,
    oppScore,
    tags: lead.tags || [],
    previewMessage: buildOutboundMessage(workspace, lead),
  }));
}

function getOutboundStats(workspace) {
  const log = workspace._outboundLog || [];
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaySent = log.filter(e => new Date(e.at) >= todayStart).length;
  const weekSent = log.length;
  const maxDaily = Number(workspace.config?.OUTBOUND_MAX_DAILY || "20");
  return { todaySent, weekSent, maxDaily, remaining: Math.max(0, maxDaily - todaySent) };
}

module.exports = {
  processOutboundProspecting,
  processWorkspaceOutbound,
  getOutboundCandidates,
  getOutboundQueue,
  getOutboundStats,
  buildOutboundMessage,
  opportunityScore,
};
