/* ─── Conversation Cleanup Service ──────────────────────────────────────────
 *  Detects dead conversations (no reply 30+ days), archives them,
 *  and frees up memory/context.
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore, appendReport } = require("../models/store");
const { clearConversationHistory } = require("./conversation-memory");

async function processWorkspaceCleanup(workspace) {
  if (workspace.config?.AUTO_CLEANUP_ENABLED !== "true") return false;

  const staleDays = Math.max(
    7,
    parseInt(workspace.config?.AUTO_CLEANUP_STALE_DAYS || "30", 10) || 30
  );
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  let changed = false;

  for (const lead of leads) {
    if (!lead.id) continue;
    if (lead.archived) continue; // Already archived
    if (lead.stage === "closed_won") continue; // Keep won deals

    const lastActivity = Math.max(
      lead.lastInboundAt ? new Date(lead.lastInboundAt).getTime() : 0,
      lead.lastOutboundAt ? new Date(lead.lastOutboundAt).getTime() : 0,
      lead.updatedAt ? new Date(lead.updatedAt).getTime() : 0
    );

    if (!lastActivity || now - lastActivity < staleMs) continue;

    // Archive the lead
    lead.archived = true;
    lead.archivedAt = new Date().toISOString();
    lead.stage = lead.stage === "closed_lost" ? "closed_lost" : "closed_lost";
    lead.updatedAt = new Date().toISOString();

    // Clear conversation memory
    clearConversationHistory(workspace.id, lead.id);

    appendReport(workspace, {
      kind: "auto_cleanup",
      source: "cleanup_autopilot",
      ok: true,
      from: lead.id,
      message: `Archived after ${staleDays}d inactivity`,
    });
    changed = true;
  }
  return changed;
}

async function processConversationCleanup() {
  try {
    let changed = false;
    for (const ws of store.workspaces) {
      const updated = await processWorkspaceCleanup(ws);
      changed = changed || updated;
    }
    if (changed) saveStore();
  } catch (err) {
    console.error(`[ERROR] processConversationCleanup: ${err.message}`);
  }
}

module.exports = { processConversationCleanup, processWorkspaceCleanup };
