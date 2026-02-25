/* ─── Leads Routes ─────────────────────────────────────────────────────────*/

const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const { getWorkspace, hasWorkspaceRole } = require("../models/store");
const { sanitizeChoice } = require("../utils/workspace-config");
const {
  getConversationHistory,
  clearConversationHistory,
} = require("../services/conversation-memory");

const router = Router();

router.get("/:workspaceId/leads", requireAuth, async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found" });
    if (!hasWorkspaceRole(workspace, req.user.id, "member"))
      return res.status(403).json({ ok: false, error: "Forbidden" });
    res.json({ ok: true, leads: workspace.leads || [] });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get("/:workspaceId/leads/summary", requireAuth, async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found" });
    if (!hasWorkspaceRole(workspace, req.user.id, "member"))
      return res.status(403).json({ ok: false, error: "Forbidden" });

    const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
    const summary = {
      total: leads.length,
      avgScore: 0,
      byStatus: { cold: 0, warm: 0, hot: 0 },
      byStage: {
        new: 0,
        qualified: 0,
        proposal: 0,
        booking: 0,
        closed_won: 0,
        closed_lost: 0,
      },
      actionable: 0,
    };
    let scoreTotal = 0;
    for (const lead of leads) {
      const status = sanitizeChoice(lead.status, ["cold", "warm", "hot"], "cold");
      const stage = sanitizeChoice(
        lead.stage,
        ["new", "qualified", "proposal", "booking", "closed_won", "closed_lost"],
        "new"
      );
      const score = Math.min(100, Math.max(0, Number.parseInt(String(lead.score || 0), 10) || 0));
      summary.byStatus[status] += 1;
      summary.byStage[stage] += 1;
      scoreTotal += score;
      if (
        (status === "warm" || status === "hot") &&
        stage !== "closed_won" &&
        stage !== "closed_lost"
      )
        summary.actionable += 1;
    }
    summary.avgScore = leads.length ? Math.round(scoreTotal / leads.length) : 0;
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ─── Conversation History ──────────────────────────────────────────────────
router.get("/:workspaceId/leads/:contactId/history", requireAuth, async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found" });
    if (!hasWorkspaceRole(workspace, req.user.id, "member"))
      return res.status(403).json({ ok: false, error: "Forbidden" });
    const contactId = decodeURIComponent(req.params.contactId);
    const history = getConversationHistory(req.params.workspaceId, contactId);
    res.json({ ok: true, contactId, history });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete("/:workspaceId/leads/:contactId/history", requireAuth, async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found" });
    if (!hasWorkspaceRole(workspace, req.user.id, "member"))
      return res.status(403).json({ ok: false, error: "Forbidden" });
    const contactId = decodeURIComponent(req.params.contactId);
    clearConversationHistory(req.params.workspaceId, contactId);
    res.json({ ok: true, message: "Conversation history cleared." });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
