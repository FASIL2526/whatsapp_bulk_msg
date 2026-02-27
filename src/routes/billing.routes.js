/* ─── Billing Routes ────────────────────────────────────────────────────────
 *  Plan management, usage dashboard, subscription lifecycle.
 *  Plans are per-user, not per-workspace.
 * ─────────────────────────────────────────────────────────────────────────── */

const { Router } = require("express");
const { requireWorkspace } = require("../middleware/auth");
const { store, saveStore, getUserById } = require("../models/store");
const {
  getAllPlans,
  getPlanSummary,
  setUserPlan,
  startTrial,
  cancelPlan,
  getUserPlan,
  getUserUsage,
} = require("../services/plan.service");

const router = Router();

// ─── Public: list all available plans ──────────────────────────────────────
router.get("/plans", (_req, res) => {
  res.json({ ok: true, plans: getAllPlans() });
});

// ─── User plan summary (current plan + usage) ─────────────────────────────
router.get("/:workspaceId/billing", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const user = req.user;
  res.json({ ok: true, ...getPlanSummary(user, workspace) });
});

// ─── Change plan (user-level) ─────────────────────────────────────────────
router.post("/:workspaceId/billing/plan", (req, res) => {
  const workspace = requireWorkspace(req, res, "owner");
  if (!workspace) return;
  const user = req.user;
  const { planId, paymentMethod, billingEmail } = req.body || {};
  if (!planId) return res.status(400).json({ ok: false, error: "planId is required." });

  try {
    const plan = setUserPlan(user, planId, {
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
  const user = req.user;
  const planId = req.body?.planId || "pro";

  // Prevent multiple trials
  if (user.plan?.trialEndsAt) {
    return res.status(400).json({ ok: false, error: "Trial already used for this account." });
  }

  try {
    const plan = startTrial(user, planId);
    res.json({ ok: true, plan, message: `${plan.name} trial started! Ends at ${plan.trialEndsAt}.` });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ─── Cancel subscription ──────────────────────────────────────────────────
router.post("/:workspaceId/billing/cancel", (req, res) => {
  const workspace = requireWorkspace(req, res, "owner");
  if (!workspace) return;
  const user = req.user;
  try {
    const plan = cancelPlan(user);
    res.json({ ok: true, plan, message: "Subscription cancelled. You'll be downgraded to Free at the end of the billing cycle." });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ─── Super admin: billing overview ────────────────────────────────────────
router.get("/admin/billing/overview", (req, res) => {
  const adminUsername = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
  if (req.user?.username !== adminUsername) {
    return res.status(403).json({ ok: false, error: "Super admin access required." });
  }

  // Build per-user overview (plans are on users now)
  const usersOverview = store.users.map(u => {
    const plan = getUserPlan(u);
    const usage = u._usage || {};
    const userWorkspaces = store.workspaces.filter(ws =>
      (ws.members || []).some(m => m.userId === u.id)
    );
    return {
      id: u.id,
      username: u.username,
      plan: plan.id,
      planName: plan.name,
      status: u.plan?.status || "active",
      trialEndsAt: u.plan?.trialEndsAt || null,
      messagesSent: usage.messagesSent || 0,
      aiCalls: usage.aiCalls || 0,
      workspaceCount: userWorkspaces.length,
      createdAt: u.createdAt,
    };
  });

  const totalRevenue = usersOverview.reduce((sum, u) => {
    const plan = getAllPlans().find(p => p.id === u.plan);
    return sum + (u.status === "active" ? (plan?.price || 0) : 0);
  }, 0);

  // Basic workspace info for admin panel
  const workspacesOverview = store.workspaces.map(ws => ({
    id: ws.id,
    name: ws.name,
    members: (ws.members || []).length,
    leads: (ws.leads || []).length,
    createdAt: ws.createdAt,
  }));

  res.json({
    ok: true,
    totalWorkspaces: store.workspaces.length,
    totalUsers: store.users.length,
    monthlyRevenue: totalRevenue,
    currency: "USD",
    users: usersOverview,
    workspaces: workspacesOverview,
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

  const users = store.users.map(u => {
    const plan = getUserPlan(u);
    return {
      id: u.id,
      username: u.username,
      plan: plan.id,
      planName: plan.name,
      planStatus: u.plan?.status || "active",
      createdAt: u.createdAt,
      workspaces: store.workspaces
        .filter(ws => (ws.members || []).some(m => m.userId === u.id))
        .map(ws => ({ id: ws.id, name: ws.name, role: (ws.members || []).find(m => m.userId === u.id)?.role })),
    };
  });
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

// ─── Super admin: change a user's plan ────────────────────────────────────
router.post("/admin/users/:userId/plan", (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ ok: false, error: "Super admin access required." });

  const user = getUserById(req.params.userId);
  if (!user) return res.status(404).json({ ok: false, error: "User not found." });

  const { planId } = req.body || {};
  if (!planId) return res.status(400).json({ ok: false, error: "planId is required." });

  try {
    const plan = setUserPlan(user, planId, {
      paymentMethod: "admin_override",
      lastPaymentAt: new Date().toISOString(),
    });
    res.json({ ok: true, plan, message: `User ${user.username} set to ${plan.name}.` });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ─── Super admin: reset user usage counters ───────────────────────────────
router.post("/admin/users/:userId/reset-usage", (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ ok: false, error: "Super admin access required." });

  const user = getUserById(req.params.userId);
  if (!user) return res.status(404).json({ ok: false, error: "User not found." });

  const now = new Date();
  user._usage = {
    messagesSent: 0,
    aiCalls: 0,
    cycleStart: now.toISOString(),
    cycleResetAt: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
  };
  saveStore();
  res.json({ ok: true, message: `Usage counters reset for ${user.username}.` });
});

module.exports = router;
