/* ─── Lead Routing Service ──────────────────────────────────────────────────
 *  Based on score/stage, autonomously assigns leads to different
 *  response strategies (nurture vs hard-close vs support).
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore, appendReport } = require("../models/store");

/**
 * Route categories:
 *  - nurture:   cold/new leads, score < 40
 *  - engage:    warm leads, score 40-69
 *  - close:     hot leads, score >= 70
 *  - support:   leads asking questions, with objections
 *  - retain:    closed_lost leads showing re-interest
 */
function routeLead(lead) {
  const score = lead.score || 0;
  const status = lead.status || "cold";
  const stage = lead.stage || "new";

  if (stage === "closed_lost") {
    // Check if they re-engaged
    if (lead.lastInboundAt) {
      const lastMsg = new Date(lead.lastInboundAt).getTime();
      if (Date.now() - lastMsg < 7 * 24 * 60 * 60 * 1000) return "retain";
    }
    return "archive";
  }
  if (stage === "closed_won") return "completed";

  if (lead.primaryObjection && lead.primaryObjection.length > 0) return "support";
  if (status === "hot" || score >= 70) return "close";
  if (status === "warm" || score >= 40) return "engage";
  return "nurture";
}

async function processWorkspaceLeadRouting(workspace) {
  if (workspace.config?.AUTO_LEAD_ROUTING_ENABLED !== "true") return false;

  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  let changed = false;

  for (const lead of leads) {
    if (!lead.id) continue;
    const newRoute = routeLead(lead);
    if (lead.route !== newRoute) {
      const oldRoute = lead.route || "unrouted";
      lead.route = newRoute;
      lead.updatedAt = new Date().toISOString();
      changed = true;

      appendReport(workspace, {
        kind: "auto_routing",
        source: "routing_autopilot",
        ok: true,
        from: lead.id,
        message: `Routed: ${oldRoute} → ${newRoute}`,
      });
    }
  }
  return changed;
}

async function processLeadRouting() {
  try {
    let changed = false;
    for (const ws of store.workspaces) {
      const updated = await processWorkspaceLeadRouting(ws);
      changed = changed || updated;
    }
    if (changed) saveStore();
  } catch (err) {
    console.error(`[ERROR] processLeadRouting: ${err.message}`);
  }
}

module.exports = { processLeadRouting, processWorkspaceLeadRouting, routeLead };
