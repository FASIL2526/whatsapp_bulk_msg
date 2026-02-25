/* ─── Goal Planner Service ──────────────────────────────────────────────────
 *  Goal-driven planning: given a weekly target (e.g. "book 10 calls"),
 *  breaks it into daily actions, tracks progress, and self-adjusts
 *  outbound intensity, follow-up cadence, and strategy mix.
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore, getRuntime, appendReport } = require("../models/store");
const { DEFAULT_CONFIG } = require("../config/default-config");
const { sanitizeText } = require("../utils/workspace-config");

// ─── Goal types ────────────────────────────────────────────────────────────
const GOAL_TYPES = {
  bookings: {
    label: "Book calls",
    measure: (ws) => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      return (ws.bookings || []).filter(b =>
        b.status === "confirmed" && new Date(b.createdAt) >= weekAgo
      ).length;
    },
  },
  hot_leads: {
    label: "Generate hot leads",
    measure: (ws) => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return (ws.leads || []).filter(l =>
        l.status === "hot" && new Date(l.updatedAt || 0) >= weekAgo
      ).length;
    },
  },
  qualified: {
    label: "Qualify leads",
    measure: (ws) => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return (ws.leads || []).filter(l =>
        l.stage === "qualified" && new Date(l.updatedAt || 0) >= weekAgo
      ).length;
    },
  },
  replies: {
    label: "Get replies",
    measure: (ws) => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return (ws.reports || []).filter(r =>
        r.kind === "auto_reply" && r.ok && new Date(r.at) >= weekAgo
      ).length;
    },
  },
  revenue: {
    label: "Close revenue",
    measure: (ws) => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return (ws.leads || []).filter(l =>
        l.stage === "closed_won" && new Date(l.updatedAt || 0) >= weekAgo
      ).length;
    },
  },
};

// ─── Plan computation ──────────────────────────────────────────────────────
function computePlan(workspace) {
  const goal = getGoal(workspace);
  if (!goal) return null;

  const goalType = GOAL_TYPES[goal.type];
  if (!goalType) return null;

  const current = goalType.measure(workspace);
  const target = goal.weeklyTarget;
  const remaining = Math.max(0, target - current);
  const dayOfWeek = new Date().getDay(); // 0=Sun ... 6=Sat
  const daysLeft = Math.max(1, 7 - dayOfWeek);
  const dailyTarget = Math.ceil(remaining / daysLeft);
  const progressPct = target > 0 ? Math.round((current / target) * 100) : 0;
  const onTrack = progressPct >= Math.round(((7 - daysLeft) / 7) * 100);

  // Strategy adjustments based on progress
  const adjustments = [];
  if (remaining === 0) {
    adjustments.push({ action: "celebrate", detail: "Weekly goal achieved! 🎉" });
  } else if (!onTrack && remaining > daysLeft * 2) {
    adjustments.push({ action: "increase_outbound", detail: `Increase daily outbound to ${dailyTarget + 3} to catch up` });
    adjustments.push({ action: "shorten_followup", detail: "Reduce follow-up delay to 60 minutes" });
    adjustments.push({ action: "expand_audience", detail: "Consider re-engaging cold leads" });
  } else if (!onTrack) {
    adjustments.push({ action: "increase_outbound", detail: `Bump daily outbound to ${dailyTarget + 1}` });
  }

  // If close to goal, focus on high-value
  if (remaining <= 2 && remaining > 0) {
    adjustments.push({ action: "focus_hot", detail: "Prioritise hot leads only for final push" });
  }

  return {
    goalType: goal.type,
    goalLabel: goalType.label,
    weeklyTarget: target,
    current,
    remaining,
    daysLeft,
    dailyTarget,
    progressPct,
    onTrack,
    adjustments,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Auto-adjust outbound config based on plan ─────────────────────────────
function applyPlanAdjustments(workspace) {
  const plan = computePlan(workspace);
  if (!plan || plan.adjustments.length === 0) return false;

  let changed = false;
  for (const adj of plan.adjustments) {
    if (adj.action === "increase_outbound") {
      const newMax = String(Math.min(50, plan.dailyTarget + 3));
      if (workspace.config.OUTBOUND_MAX_DAILY !== newMax) {
        workspace.config.OUTBOUND_MAX_DAILY = newMax;
        changed = true;
      }
    }
    if (adj.action === "shorten_followup" && workspace.config.AI_FOLLOW_UP_ENABLED === "true") {
      if (Number(workspace.config.AI_FOLLOW_UP_DELAY_MINUTES || "180") > 60) {
        workspace.config.AI_FOLLOW_UP_DELAY_MINUTES = "60";
        changed = true;
      }
    }
    if (adj.action === "expand_audience" && workspace.config.AUTO_REENGAGE_ENABLED !== "true") {
      workspace.config.AUTO_REENGAGE_ENABLED = "true";
      changed = true;
    }
  }

  // Store plan snapshot
  workspace._goalPlan = plan;

  if (changed) saveStore();
  return changed;
}

// ─── Goal CRUD ─────────────────────────────────────────────────────────────
function getGoal(workspace) {
  return workspace._salesGoal || null;
}

function setGoal(workspace, type, weeklyTarget) {
  if (!GOAL_TYPES[type]) return null;
  const goal = {
    type,
    weeklyTarget: Math.max(1, Number(weeklyTarget) || 5),
    createdAt: new Date().toISOString(),
  };
  workspace._salesGoal = goal;
  saveStore();
  return goal;
}

function clearGoal(workspace) {
  workspace._salesGoal = null;
  workspace._goalPlan = null;
  saveStore();
}

// ─── Sweep: run planner once per hour ──────────────────────────────────────
let _lastPlanHour = -1;

async function processGoalPlanner() {
  const currentHour = new Date().getHours();
  if (currentHour === _lastPlanHour) return; // run once per hour
  _lastPlanHour = currentHour;

  try {
    for (const workspace of store.workspaces) {
      const config = workspace.config || DEFAULT_CONFIG;
      if (config.GOAL_PLANNER_ENABLED !== "true") continue;
      const adjusted = applyPlanAdjustments(workspace);
      if (adjusted) {
        appendReport(workspace, {
          kind: "goal_plan_adjust",
          source: "goal_planner",
          ok: true,
          plan: workspace._goalPlan,
        });
      }
    }
  } catch (err) {
    console.error(`[ERROR] processGoalPlanner: ${err.message}`);
  }
}

// ─── Daily progress report (for digest integration) ───────────────────────
function getGoalProgressSummary(workspace) {
  const plan = computePlan(workspace);
  if (!plan) return null;
  const emoji = plan.onTrack ? "🟢" : plan.progressPct >= 50 ? "🟡" : "🔴";
  return {
    ...plan,
    emoji,
    summary: `${emoji} ${plan.goalLabel}: ${plan.current}/${plan.weeklyTarget} (${plan.progressPct}%) — ${plan.remaining} to go, ${plan.daysLeft} days left`,
  };
}

module.exports = {
  processGoalPlanner,
  computePlan,
  applyPlanAdjustments,
  getGoal,
  setGoal,
  clearGoal,
  getGoalProgressSummary,
  GOAL_TYPES,
};
