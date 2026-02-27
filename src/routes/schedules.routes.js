/* ─── Schedules Routes ─────────────────────────────────────────────────────*/

const { Router } = require("express");
const { requireAuth, requireWorkspace } = require("../middleware/auth");
const { requirePlanFeature, requirePlanLimit } = require("../middleware/plan-guard");
const { saveStore } = require("../models/store");
const { sanitizeText, sanitizeMultilineText } = require("../utils/workspace-config");

const router = Router();

router.post("/:workspaceId/schedules", requireAuth, requirePlanFeature("scheduling"), requirePlanLimit("scheduledMessages"), (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  try {
    const message = sanitizeMultilineText(req.body?.message || "", "");
    const sendAt = sanitizeText(req.body?.sendAt, "");
    if (!message && !req.body?.mediaId) {
      return res.status(400).json({ ok: false, error: "message or mediaId is required" });
    }
    const when = new Date(sendAt || "");
    if (sendAt && Number.isNaN(when.getTime())) {
      return res.status(400).json({ ok: false, error: "sendAt must be a valid ISO datetime" });
    }
    const id = `sm_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`;
    workspace.scheduledMessages = Array.isArray(workspace.scheduledMessages)
      ? workspace.scheduledMessages
      : [];
    const rec = {
      id,
      message,
      sendAt: sendAt || new Date().toISOString(),
      status: "pending",
      mediaId: sanitizeText(req.body?.mediaId, ""),
      createdAt: new Date().toISOString(),
      sentAt: "",
    };
    workspace.scheduledMessages.push(rec);
    saveStore();
    res.json({ ok: true, scheduled: rec });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/:workspaceId/schedules", requireAuth, (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({
    ok: true,
    scheduled: Array.isArray(workspace.scheduledMessages) ? workspace.scheduledMessages : [],
  });
});

router.delete("/:workspaceId/schedules/:scheduleId", requireAuth, (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const id = sanitizeText(req.params.scheduleId, "");
  workspace.scheduledMessages = Array.isArray(workspace.scheduledMessages)
    ? workspace.scheduledMessages
    : [];
  const idx = workspace.scheduledMessages.findIndex((s) => s.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: "Scheduled message not found" });
  workspace.scheduledMessages[idx].status = "cancelled";
  workspace.scheduledMessages[idx].updatedAt = new Date().toISOString();
  saveStore();
  res.json({ ok: true });
});

module.exports = router;
