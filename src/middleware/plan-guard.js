/* ─── Plan Guard Middleware ──────────────────────────────────────────────────
 *  Middleware to enforce SaaS plan limits and feature gates.
 *  Use in route chains: router.post("/send", requirePlanFeature("bulkMessaging"), ...)
 * ─────────────────────────────────────────────────────────────────────────── */

const { getWorkspace } = require("../models/store");
const { checkFeature, checkLimit, getWorkspacePlan } = require("../services/plan.service");

/**
 * Block the request if the workspace's plan doesn't include the given feature.
 */
function requirePlanFeature(featureKey) {
  return (req, res, next) => {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return next(); // let requireWorkspace handle 404

    if (!checkFeature(workspace, featureKey)) {
      const plan = getWorkspacePlan(workspace);
      return res.status(403).json({
        ok: false,
        error: `This feature requires an upgrade. Your current plan (${plan.name}) does not include "${featureKey}".`,
        upgrade: true,
        currentPlan: plan.id,
      });
    }
    next();
  };
}

/**
 * Block the request if a usage limit has been reached.
 */
function requirePlanLimit(limitKey) {
  return (req, res, next) => {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return next();

    const check = checkLimit(workspace, limitKey);
    if (!check.ok) {
      const plan = getWorkspacePlan(workspace);
      return res.status(429).json({
        ok: false,
        error: `Monthly ${limitKey} limit reached (${check.used}/${check.limit}). Upgrade your plan for more.`,
        upgrade: true,
        currentPlan: plan.id,
        limit: check.limit,
        used: check.used,
      });
    }
    next();
  };
}

module.exports = {
  requirePlanFeature,
  requirePlanLimit,
};
