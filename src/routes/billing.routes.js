/* ─── Billing Routes ────────────────────────────────────────────────────────
 *  Plan management, usage dashboard, subscription lifecycle.
 * ─────────────────────────────────────────────────────────────────────────── */

const { Router } = require("express");
const { requireWorkspace } = require("../middleware/auth");
const { store, saveStore } = require("../models/store");
const {
  getAllPlans,
  getPlanSummary,
  setWorkspacePlan,
  startTrial,
  cancelPlan,
  getWorkspacePlan,
  getWorkspaceUsage,
} = require("../services/plan.service");

const router = Router();

// ─── Public: list all available plans ──────────────────────────────────────
router.get("/plans", (_req, res) => {
  res.json({ ok: true, plans: getAllPlans() });
});

// ─── Workspace plan summary (current plan + usage) ────────────────────────
router.get("/:workspaceId/billing", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({ ok: true, ...getPlanSummary(workspace) });
});

// ─── Change plan (admin only) ─────────────────────────────────────────────
router.post("/:workspaceId/billing/plan", (req, res) => {
  const workspace = requireWorkspace(req, res, "owner");
  if (!workspace) return;
  const { planId, paymentMethod, billingEmail } = req.body || {};
  if (!planId) return res.status(400).json({ ok: false, error: "planId is required." });

  try {
    const plan = setWorkspacePlan(workspace, planId, {
      paymentMethod: paymentMethod || "manual",
      billingEmail: billingEmail || null,
      lastPaymentAt: new Date().toISOString(),
    });
    res.json({ ok: true, plan, message: `Plan changed to ${plan.name}.` });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ─── Start a trial ────────────────────────────────────────────────────────
router.post("/:workspaceId/billing/trial", (req, res) => {
  const workspace = requireWorkspace(req, res, "owner");
  if (!workspace) return;
  const planId = req.body?.planId || "pro";

  // Prevent multiple trials
  if (workspace.plan?.trialEndsAt) {
    return res.status(400).json({ ok: false, error: "Trial already used for this workspace." });
  }

  try {
    const plan = startTrial(workspace, planId);
    res.json({ ok: true, plan, message: `${plan.name} trial started! Ends at ${plan.trialEndsAt}.` });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ─── Cancel subscription ──────────────────────────────────────────────────
router.post("/:workspaceId/billing/cancel", (req, res) => {
  const workspace = requireWorkspace(req, res, "owner");
  if (!workspace) return;
  try {
    const plan = cancelPlan(workspace);
    res.json({ ok: true, plan, message: "Subscription cancelled. You'll be downgraded to Free at the end of the billing cycle." });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ─── Super admin: all workspace billing overview ──────────────────────────
router.get("/admin/billing/overview", (req, res) => {
  // Only bootstrap admin can see this
  const adminUsername = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
  if (req.user?.username !== adminUsername) {
    return res.status(403).json({ ok: false, error: "Super admin access required." });
  }

  const overview = store.workspaces.map(ws => {
    const plan = getWorkspacePlan(ws);
    const usage = ws._usage || {};
    return {
      id: ws.id,
      name: ws.name,
      plan: plan.id,
      planName: plan.name,
      status: ws.plan?.status || "active",
      trialEndsAt: ws.plan?.trialEndsAt || null,
      messagesSent: usage.messagesSent || 0,
      aiCalls: usage.aiCalls || 0,
      leads: (ws.leads || []).length,
      members: (ws.members || []).length,
      createdAt: ws.createdAt,
    };
  });

  const totalRevenue = overview.reduce((sum, ws) => {
    const plan = getAllPlans().find(p => p.id === ws.plan);
    return sum + (ws.status === "active" ? (plan?.price || 0) : 0);
  }, 0);

  res.json({
    ok: true,
    totalWorkspaces: overview.length,
    totalUsers: store.users.length,
    monthlyRevenue: totalRevenue,
    currency: "USD",
    workspaces: overview,
  });
});

// ─── Helper: super admin check ────────────────────────────────────────────
function isSuperAdmin(req) {
  const adminUsername = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
  return req.user?.username === adminUsername;
}

// ─── Super admin: list all users ──────────────────────────────────────────
router.get("/admin/users", (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ ok: false, error: "Super admin access required." });

  const users = store.users.map(u => ({
    id: u.id,
    username: u.username,
    createdAt: u.createdAt,
    workspaces: store.workspaces
      .filter(ws => (ws.members || []).some(m => m.userId === u.id))
      .map(ws => ({ id: ws.id, name: ws.name, role: (ws.members || []).find(m => m.userId === u.id)?.role })),
  }));
  res.json({ ok: true, users });
});

// ─── Super admin: delete a user ───────────────────────────────────────────
router.delete("/admin/users/:userId", (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ ok: false, error: "Super admin access required." });

  const idx = store.users.findIndex(u => u.id === req.params.userId);
  if (idx === -1) return res.status(404).json({ ok: false, error: "User not found." });
  // Prevent deleting self
  if (store.users[idx].id === req.user.id) return res.status(400).json({ ok: false, error: "Cannot delete yourself." });

  const removed = store.users.splice(idx, 1)[0];
  // Also remove from workspace members
  store.workspaces.forEach(ws => {
    ws.members = (ws.members || []).filter(m => m.userId !== removed.id);
  });
  saveStore();
  res.json({ ok: true, removed: removed.username });
});

// ─── Super admin: change a workspace's plan ───────────────────────────────
router.post("/admin/workspaces/:workspaceId/plan", (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ ok: false, error: "Super admin access required." });

  const { getWorkspace } = require("../models/store");
  const workspace = getWorkspace(req.params.workspaceId);
  if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found." });

  const { planId } = req.body || {};
  if (!planId) return res.status(400).json({ ok: false, error: "planId is required." });

  try {
    const plan = setWorkspacePlan(workspace, planId, {
      paymentMethod: "admin_override",
      lastPaymentAt: new Date().toISOString(),
    });
    res.json({ ok: true, plan, message: `Workspace ${workspace.name} set to ${plan.name}.` });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ─── Super admin: reset workspace usage counters ──────────────────────────
router.post("/admin/workspaces/:workspaceId/reset-usage", (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ ok: false, error: "Super admin access required." });

  const { getWorkspace } = require("../models/store");
  const workspace = getWorkspace(req.params.workspaceId);
  if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found." });

  const now = new Date();
  workspace._usage = {
    messagesSent: 0,
    aiCalls: 0,
    cycleStart: now.toISOString(),
    cycleResetAt: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
  };
  saveStore();
  res.json({ ok: true, message: `Usage counters reset for ${workspace.name}.` });
});

module.exports = router;
