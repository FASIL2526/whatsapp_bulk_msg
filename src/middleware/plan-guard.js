/* ─── Plan Guard Middleware ──────────────────────────────────────────────────
 *  Middleware to enforce SaaS plan limits and feature gates.
 *  Plans are per-user. Use in route chains: router.post("/send", requirePlanFeature("bulkMessaging"), ...)
 * ─────────────────────────────────────────────────────────────────────────── */

const { checkFeature, checkLimit, getUserPlan } = require("../services/plan.service");

/**
 * Block the request if the user's plan doesn't include the given feature.
 */
function requirePlanFeature(featureKey) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) return next(); // let requireAuth handle 401

    if (!checkFeature(user, featureKey)) {
      const plan = getUserPlan(user);
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
    const user = req.user;
    if (!user) return next();

    const check = checkLimit(user, limitKey);
    if (!check.ok) {
      const plan = getUserPlan(user);
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
