/* ─── Self-Healing Workflows Service ────────────────────────────────────────
 *  Monitors all autonomous features for poor performance and
 *  auto-switches strategies: changes drip sequences, adjusts
 *  follow-up timing, disables broken A/B tests, tweaks re-engagement.
 *  Runs as a daily background sweep.
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore, appendReport } = require("../models/store");
const { DEFAULT_CONFIG } = require("../config/default-config");

// ─── Health checks for each subsystem ──────────────────────────────────────
function checkFollowUpHealth(workspace) {
  const config = workspace.config || DEFAULT_CONFIG;
  if (config.AI_FOLLOW_UP_ENABLED !== "true") return null;

  const reports = (workspace.reports || []);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const followUps = reports.filter(r =>
    r.kind === "auto_follow_up" && r.ok && new Date(r.at).getTime() > weekAgo
  );
  const replies = reports.filter(r =>
    r.kind === "auto_reply" && r.ok && new Date(r.at).getTime() > weekAgo
  );

  if (followUps.length < 5) return null; // not enough data

  // How many follow-ups led to a reply within 24h?
  let conversions = 0;
  for (const fu of followUps) {
    const fuTime = new Date(fu.at).getTime();
    const gotReply = replies.some(r =>
      r.from === fu.from && new Date(r.at).getTime() > fuTime &&
      new Date(r.at).getTime() - fuTime < 24 * 60 * 60 * 1000
    );
    if (gotReply) conversions++;
  }

  const rate = conversions / followUps.length;
  return {
    feature: "auto_follow_up",
    sent: followUps.length,
    conversions,
    rate,
    healthy: rate >= 0.05, // at least 5% response rate
  };
}

function checkDripHealth(workspace) {
  const config = workspace.config || DEFAULT_CONFIG;
  if (config.NURTURE_DRIP_ENABLED !== "true") return null;

  const reports = (workspace.reports || []);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const drips = reports.filter(r =>
    r.kind === "nurture_drip" && r.ok && new Date(r.at).getTime() > weekAgo
  );
  const replies = reports.filter(r =>
    r.kind === "auto_reply" && r.ok && new Date(r.at).getTime() > weekAgo
  );

  if (drips.length < 5) return null;

  let conversions = 0;
  for (const d of drips) {
    const dTime = new Date(d.at).getTime();
    const gotReply = replies.some(r =>
      r.from === d.from && new Date(r.at).getTime() > dTime &&
      new Date(r.at).getTime() - dTime < 48 * 60 * 60 * 1000
    );
    if (gotReply) conversions++;
  }

  const rate = conversions / drips.length;
  return {
    feature: "nurture_drip",
    sent: drips.length,
    conversions,
    rate,
    healthy: rate >= 0.03,
  };
}

function checkReengageHealth(workspace) {
  const config = workspace.config || DEFAULT_CONFIG;
  if (config.AUTO_REENGAGE_ENABLED !== "true") return null;

  const reports = (workspace.reports || []);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const reengages = reports.filter(r =>
    r.kind === "reengage" && r.ok && new Date(r.at).getTime() > weekAgo
  );
  const replies = reports.filter(r =>
    r.kind === "auto_reply" && r.ok && new Date(r.at).getTime() > weekAgo
  );

  if (reengages.length < 5) return null;

  let conversions = 0;
  for (const re of reengages) {
    const reTime = new Date(re.at).getTime();
    const gotReply = replies.some(r =>
      r.from === re.from && new Date(r.at).getTime() > reTime &&
      new Date(r.at).getTime() - reTime < 72 * 60 * 60 * 1000
    );
    if (gotReply) conversions++;
  }

  const rate = conversions / reengages.length;
  return {
    feature: "auto_reengage",
    sent: reengages.length,
    conversions,
    rate,
    healthy: rate >= 0.02,
  };
}

function checkOutboundHealth(workspace) {
  const config = workspace.config || DEFAULT_CONFIG;
  if (config.OUTBOUND_PROSPECTING_ENABLED !== "true") return null;

  const reports = (workspace.reports || []);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const outbounds = reports.filter(r =>
    r.kind === "outbound_prospect" && r.ok && new Date(r.at).getTime() > weekAgo
  );
  const replies = reports.filter(r =>
    r.kind === "auto_reply" && r.ok && new Date(r.at).getTime() > weekAgo
  );

  if (outbounds.length < 10) return null;

  let conversions = 0;
  for (const ob of outbounds) {
    const obTime = new Date(ob.at).getTime();
    const gotReply = replies.some(r =>
      r.from === ob.from && new Date(r.at).getTime() > obTime &&
      new Date(r.at).getTime() - obTime < 24 * 60 * 60 * 1000
    );
    if (gotReply) conversions++;
  }

  const rate = conversions / outbounds.length;
  return {
    feature: "outbound_prospecting",
    sent: outbounds.length,
    conversions,
    rate,
    healthy: rate >= 0.05,
  };
}

// ─── Generate healing actions ──────────────────────────────────────────────
function generateHealingActions(healthChecks) {
  const actions = [];
  for (const check of healthChecks) {
    if (!check || check.healthy) continue;

    if (check.feature === "auto_follow_up" && check.rate < 0.05) {
      actions.push({
        feature: check.feature,
        action: "adjust_delay",
        detail: "Follow-up reply rate is below 5%. Increasing delay to 360 minutes for less aggressive cadence.",
        configKey: "AI_FOLLOW_UP_DELAY_MINUTES",
        newValue: "360",
      });
      if (check.rate < 0.02) {
        actions.push({
          feature: check.feature,
          action: "reduce_attempts",
          detail: "Very low response. Reducing max attempts from current to 2.",
          configKey: "AI_FOLLOW_UP_MAX_ATTEMPTS",
          newValue: "2",
        });
      }
    }

    if (check.feature === "nurture_drip" && check.rate < 0.03) {
      actions.push({
        feature: check.feature,
        action: "extend_spacing",
        detail: "Drip sequence response rate is below 3%. Messages may be too frequent — needs manual review of drip content.",
        configKey: null,
        newValue: null,
      });
    }

    if (check.feature === "auto_reengage" && check.rate < 0.02) {
      actions.push({
        feature: check.feature,
        action: "increase_stale_days",
        detail: "Re-engagement messages aren't working. Increasing stale threshold to give leads more space.",
        configKey: "AUTO_REENGAGE_STALE_DAYS",
        newValue: "7",
      });
      if (check.rate === 0) {
        actions.push({
          feature: check.feature,
          action: "disable",
          detail: "Zero response from re-engagement. Disabling to prevent spam.",
          configKey: "AUTO_REENGAGE_ENABLED",
          newValue: "false",
        });
      }
    }

    if (check.feature === "outbound_prospecting" && check.rate < 0.05) {
      actions.push({
        feature: check.feature,
        action: "reduce_volume",
        detail: "Outbound reply rate below 5%. Reducing daily volume and increasing cooldown.",
        configKey: "OUTBOUND_MAX_DAILY",
        newValue: "10",
      });
      actions.push({
        feature: check.feature,
        action: "increase_cooldown",
        detail: "Adding longer cooldown between outbound messages.",
        configKey: "OUTBOUND_COOLDOWN_HOURS",
        newValue: "12",
      });
    }
  }
  return actions;
}

// ─── Apply healing ─────────────────────────────────────────────────────────
function applyHealing(workspace) {
  const checks = [
    checkFollowUpHealth(workspace),
    checkDripHealth(workspace),
    checkReengageHealth(workspace),
    checkOutboundHealth(workspace),
  ].filter(Boolean);

  const actions = generateHealingActions(checks);
  let applied = 0;

  for (const action of actions) {
    if (action.configKey && action.newValue) {
      workspace.config[action.configKey] = action.newValue;
      applied++;
    }
  }

  // Store health snapshot
  workspace._workflowHealth = {
    checks,
    actions,
    appliedCount: applied,
    checkedAt: new Date().toISOString(),
  };

  if (applied > 0) saveStore();
  return { checks, actions, applied };
}

// ─── Sweep: run once per day ──────────────────────────────────────────────
let _lastHealDate = "";

async function processSelfHealing() {
  const today = new Date().toISOString().slice(0, 10);
  if (today === _lastHealDate) return;

  try {
    for (const workspace of store.workspaces) {
      const config = workspace.config || DEFAULT_CONFIG;
      if (config.SELF_HEALING_ENABLED !== "true") continue;

      const result = applyHealing(workspace);
      if (result.applied > 0) {
        appendReport(workspace, {
          kind: "self_healing",
          source: "self_healer",
          ok: true,
          checks: result.checks.map(c => `${c.feature}: ${(c.rate * 100).toFixed(1)}% ${c.healthy ? "✅" : "⚠️"}`),
          actions: result.actions.map(a => a.detail),
          appliedCount: result.applied,
        });
      }
    }
    _lastHealDate = today;
  } catch (err) {
    console.error(`[ERROR] processSelfHealing: ${err.message}`);
  }
}

// ─── API helpers ───────────────────────────────────────────────────────────
function getWorkflowHealth(workspace) {
  const checks = [
    checkFollowUpHealth(workspace),
    checkDripHealth(workspace),
    checkReengageHealth(workspace),
    checkOutboundHealth(workspace),
  ].filter(Boolean);

  const actions = generateHealingActions(checks);
  const lastHealing = workspace._workflowHealth || null;

  return { checks, suggestedActions: actions, lastHealing };
}

module.exports = {
  processSelfHealing,
  applyHealing,
  getWorkflowHealth,
  checkFollowUpHealth,
  checkDripHealth,
  checkReengageHealth,
  checkOutboundHealth,
};
