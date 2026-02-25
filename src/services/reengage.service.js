/* ─── Re-engagement Service ─────────────────────────────────────────────────
 *  Detects cold/stale leads and autonomously sends win-back messages.
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore, getRuntime, appendReport } = require("../models/store");

const WIN_BACK_TEMPLATES = [
  "Hey {{name}}, just checking in — anything I can help with regarding what we discussed?",
  "Hi {{name}}, I know things get busy! Still open to exploring how we can help you?",
  "{{name}}, quick note — we've had some updates since we last spoke. Want a quick recap?",
  "Hey {{name}}, no pressure at all — just wanted to make sure you have everything you need.",
];

function personalizeMessage(template, lead) {
  const name = lead.name || lead.id?.split("@")[0] || "there";
  return template.replace(/\{\{name\}\}/gi, name);
}

async function processWorkspaceReengagement(workspace) {
  if (workspace.config?.AUTO_REENGAGE_ENABLED !== "true") return false;
  const runtime = getRuntime(workspace.id);
  if (!runtime.client || !runtime.ready) return false;

  const staleDays = Math.max(
    1,
    parseInt(workspace.config?.AUTO_REENGAGE_STALE_DAYS || "3", 10) || 3
  );
  const maxAttempts = Math.max(
    1,
    parseInt(workspace.config?.AUTO_REENGAGE_MAX_ATTEMPTS || "2", 10) || 2
  );
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  let changed = false;

  for (const lead of leads) {
    if (!lead.id) continue;
    if (lead.stage === "closed_won" || lead.stage === "closed_lost") continue;

    const reengageCount = lead.reengageCount || 0;
    if (reengageCount >= maxAttempts) continue;

    // Check staleness: no inbound for staleDays
    const lastActivity = lead.lastInboundAt
      ? new Date(lead.lastInboundAt).getTime()
      : lead.updatedAt
        ? new Date(lead.updatedAt).getTime()
        : 0;
    if (!lastActivity || now - lastActivity < staleMs) continue;

    // Don't re-engage if we already sent one recently (within stale window)
    const lastReengage = lead.lastReengageAt
      ? new Date(lead.lastReengageAt).getTime()
      : 0;
    if (lastReengage && now - lastReengage < staleMs) continue;

    const template = WIN_BACK_TEMPLATES[reengageCount % WIN_BACK_TEMPLATES.length];
    const text = personalizeMessage(template, lead);

    try {
      await runtime.client.sendMessage(lead.id, text);
      lead.reengageCount = reengageCount + 1;
      lead.lastReengageAt = new Date().toISOString();
      lead.lastOutboundAt = new Date().toISOString();
      lead.updatedAt = new Date().toISOString();
      appendReport(workspace, {
        kind: "auto_reengage",
        source: "reengage_autopilot",
        ok: true,
        from: lead.id,
        message: text,
      });
      changed = true;
    } catch (err) {
      appendReport(workspace, {
        kind: "auto_reengage",
        source: "reengage_autopilot",
        ok: false,
        from: lead.id,
        error: err.message,
      });
    }
  }
  return changed;
}

async function processReengagement() {
  try {
    let changed = false;
    for (const ws of store.workspaces) {
      const updated = await processWorkspaceReengagement(ws);
      changed = changed || updated;
    }
    if (changed) saveStore();
  } catch (err) {
    console.error(`[ERROR] processReengagement: ${err.message}`);
  }
}

module.exports = { processReengagement, processWorkspaceReengagement };
