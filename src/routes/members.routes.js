/* ─── Members Routes ───────────────────────────────────────────────────────*/

const { Router } = require("express");
const { requireWorkspace } = require("../middleware/auth");
const {
  saveStore,
  getUserById,
  getUserByUsername,
  normalizeUsername,
} = require("../models/store");
const { sanitizeChoice } = require("../utils/workspace-config");

const router = Router();

router.get("/:workspaceId/members", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const members = (workspace.members || [])
    .map((m) => {
      const user = getUserById(m.userId);
      if (!user) return null;
      return { userId: user.id, username: user.username, role: m.role };
    })
    .filter(Boolean);
  res.json({ ok: true, members });
});

router.post("/:workspaceId/members", (req, res) => {
  const workspace = requireWorkspace(req, res, "owner");
  if (!workspace) return;
  const username = normalizeUsername(req.body?.username);
  const role = sanitizeChoice(String(req.body?.role || "member"), ["member", "admin"], "member");
  const user = getUserByUsername(username);
  if (!user) return res.status(404).json({ ok: false, error: "User not found." });
  workspace.members = Array.isArray(workspace.members) ? workspace.members : [];
  const existing = workspace.members.find((m) => m.userId === user.id);
  if (existing) existing.role = role;
  else workspace.members.push({ userId: user.id, role });
  saveStore();
  res.json({ ok: true });
});

module.exports = router;
