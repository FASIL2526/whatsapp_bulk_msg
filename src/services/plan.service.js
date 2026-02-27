/* ─── Plan / Tier Service ───────────────────────────────────────────────────
 *  Defines SaaS plans, feature gates, and workspace plan helpers.
 *  All limits are per-workspace per billing cycle (monthly).
 * ─────────────────────────────────────────────────────────────────────────── */

const { saveStore } = require("../models/store");

// ─── Plan definitions ──────────────────────────────────────────────────────
const PLANS = {
  free: {
    id: "free",
    name: "Free",
    price: 0,
    currency: "USD",
    billing: "monthly",
    limits: {
      messagesPerMonth: 100,
      leadsMax: 25,
      aiCallsPerMonth: 50,
      workspacesPerUser: 1,
      mediaStorageMB: 10,
      scheduledMessages: 5,
      membersPerWorkspace: 1,
    },
    features: {
      autoReply: true,
      aiSalesCloser: false,
      bulkMessaging: true,
      scheduling: true,
      leadTracking: true,
      bookings: false,
      nurtureDrip: false,
      abTesting: false,
      outboundProspecting: false,
      goalPlanner: false,
      promptTuning: false,
      revenueAttribution: false,
      offerAuthority: false,
      selfHealing: false,
      whatsappAlerts: false,
      humanTakeover: false,
      statusAutopilot: false,
      csvExport: false,
      dailyDigest: false,
      escalation: false,
    },
    trialDays: 0,
  },

  starter: {
    id: "starter",
    name: "Starter",
    price: 29,
    currency: "USD",
    billing: "monthly",
    limits: {
      messagesPerMonth: 2000,
      leadsMax: 200,
      aiCallsPerMonth: 500,
      workspacesPerUser: 2,
      mediaStorageMB: 100,
      scheduledMessages: 50,
      membersPerWorkspace: 3,
    },
    features: {
      autoReply: true,
      aiSalesCloser: true,
      bulkMessaging: true,
      scheduling: true,
      leadTracking: true,
      bookings: true,
      nurtureDrip: true,
      abTesting: false,
      outboundProspecting: false,
      goalPlanner: false,
      promptTuning: false,
      revenueAttribution: true,
      offerAuthority: false,
      selfHealing: false,
      whatsappAlerts: true,
      humanTakeover: true,
      statusAutopilot: true,
      csvExport: true,
      dailyDigest: true,
      escalation: true,
    },
    trialDays: 7,
  },

  pro: {
    id: "pro",
    name: "Pro",
    price: 79,
    currency: "USD",
    billing: "monthly",
    limits: {
      messagesPerMonth: 10000,
      leadsMax: 2000,
      aiCallsPerMonth: 5000,
      workspacesPerUser: 5,
      mediaStorageMB: 500,
      scheduledMessages: 500,
      membersPerWorkspace: 10,
    },
    features: {
      autoReply: true,
      aiSalesCloser: true,
      bulkMessaging: true,
      scheduling: true,
      leadTracking: true,
      bookings: true,
      nurtureDrip: true,
      abTesting: true,
      outboundProspecting: true,
      goalPlanner: true,
      promptTuning: true,
      revenueAttribution: true,
      offerAuthority: true,
      selfHealing: true,
      whatsappAlerts: true,
      humanTakeover: true,
      statusAutopilot: true,
      csvExport: true,
      dailyDigest: true,
      escalation: true,
    },
    trialDays: 14,
  },

  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    price: 199,
    currency: "USD",
    billing: "monthly",
    limits: {
      messagesPerMonth: -1, // unlimited
      leadsMax: -1,
      aiCallsPerMonth: -1,
      workspacesPerUser: -1,
      mediaStorageMB: 5000,
      scheduledMessages: -1,
      membersPerWorkspace: -1,
    },
    features: {
      autoReply: true,
      aiSalesCloser: true,
      bulkMessaging: true,
      scheduling: true,
      leadTracking: true,
      bookings: true,
      nurtureDrip: true,
      abTesting: true,
      outboundProspecting: true,
      goalPlanner: true,
      promptTuning: true,
      revenueAttribution: true,
      offerAuthority: true,
      selfHealing: true,
      whatsappAlerts: true,
      humanTakeover: true,
      statusAutopilot: true,
      csvExport: true,
      dailyDigest: true,
      escalation: true,
    },
    trialDays: 14,
  },
};

// ─── Workspace plan helpers ────────────────────────────────────────────────

function getWorkspacePlan(workspace) {
  const planId = workspace.plan?.id || "free";
  return PLANS[planId] || PLANS.free;
}

function getWorkspaceUsage(workspace) {
  if (!workspace._usage) {
    workspace._usage = freshUsage();
  }
  // Auto-reset if billing cycle has passed
  const resetAt = workspace._usage.cycleResetAt;
  if (resetAt && new Date(resetAt).getTime() <= Date.now()) {
    workspace._usage = freshUsage();
    saveStore();
  }
  return workspace._usage;
}

function freshUsage() {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return {
    messagesSent: 0,
    aiCalls: 0,
    cycleStart: now.toISOString(),
    cycleResetAt: nextMonth.toISOString(),
  };
}

function incrementUsage(workspace, key, amount = 1) {
  const usage = getWorkspaceUsage(workspace);
  usage[key] = (usage[key] || 0) + amount;
  saveStore();
  return usage;
}

function checkLimit(workspace, limitKey, currentValueOverride) {
  const plan = getWorkspacePlan(workspace);
  const limit = plan.limits[limitKey];
  if (limit === -1) return { ok: true, limit, used: 0, remaining: Infinity };

  let used;
  if (currentValueOverride !== undefined) {
    used = currentValueOverride;
  } else {
    const usage = getWorkspaceUsage(workspace);
    const usageKeyMap = {
      messagesPerMonth: "messagesSent",
      aiCallsPerMonth: "aiCalls",
    };
    used = usage[usageKeyMap[limitKey]] || 0;
  }

  const remaining = Math.max(0, limit - used);
  return { ok: used < limit, limit, used, remaining };
}

function checkFeature(workspace, featureKey) {
  const plan = getWorkspacePlan(workspace);

  // Check trial
  if (workspace.plan?.trialEndsAt) {
    const trialEnd = new Date(workspace.plan.trialEndsAt).getTime();
    if (Date.now() <= trialEnd) {
      // During trial, all plan features are unlocked
      return plan.features[featureKey] !== undefined ? plan.features[featureKey] : false;
    }
    // Trial expired and no active subscription
    if (workspace.plan.status !== "active") {
      // Fall back to free plan features
      return PLANS.free.features[featureKey] || false;
    }
  }

  return plan.features[featureKey] || false;
}

function setWorkspacePlan(workspace, planId, options = {}) {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  const now = new Date();
  workspace.plan = {
    id: planId,
    name: plan.name,
    status: options.status || "active",
    startedAt: options.startedAt || now.toISOString(),
    trialEndsAt: options.trialEndsAt || null,
    expiresAt: options.expiresAt || null,
    cancelledAt: null,
    paymentMethod: options.paymentMethod || null,
    billingEmail: options.billingEmail || null,
    lastPaymentAt: options.lastPaymentAt || null,
  };

  // Reset usage on plan change
  workspace._usage = freshUsage();
  saveStore();
  return workspace.plan;
}

function startTrial(workspace, planId) {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`Unknown plan: ${planId}`);
  if (plan.trialDays <= 0) throw new Error(`Plan ${planId} has no trial.`);

  const now = new Date();
  const trialEnd = new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000);

  return setWorkspacePlan(workspace, planId, {
    status: "trialing",
    trialEndsAt: trialEnd.toISOString(),
  });
}

function cancelPlan(workspace) {
  if (!workspace.plan || workspace.plan.id === "free") {
    throw new Error("No active subscription to cancel.");
  }
  workspace.plan.status = "cancelled";
  workspace.plan.cancelledAt = new Date().toISOString();
  saveStore();
  return workspace.plan;
}

function getPlanSummary(workspace) {
  const plan = getWorkspacePlan(workspace);
  const usage = getWorkspaceUsage(workspace);
  const leadsCount = Array.isArray(workspace.leads) ? workspace.leads.length : 0;
  const membersCount = Array.isArray(workspace.members) ? workspace.members.length : 0;
  const mediaCount = Array.isArray(workspace.media) ? workspace.media.length : 0;
  const scheduledCount = Array.isArray(workspace.scheduledMessages)
    ? workspace.scheduledMessages.filter(s => s.status === "pending").length : 0;

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      price: plan.price,
      currency: plan.currency,
      billing: plan.billing,
    },
    subscription: workspace.plan || { id: "free", status: "active" },
    usage: {
      messagesSent: { used: usage.messagesSent || 0, limit: plan.limits.messagesPerMonth, label: "Messages / month" },
      aiCalls: { used: usage.aiCalls || 0, limit: plan.limits.aiCallsPerMonth, label: "AI calls / month" },
      leads: { used: leadsCount, limit: plan.limits.leadsMax, label: "Leads" },
      members: { used: membersCount, limit: plan.limits.membersPerWorkspace, label: "Team members" },
      scheduledMessages: { used: scheduledCount, limit: plan.limits.scheduledMessages, label: "Scheduled messages" },
    },
    features: plan.features,
    cycleResetAt: usage.cycleResetAt,
  };
}

function getAllPlans() {
  return Object.values(PLANS).map(p => ({
    id: p.id,
    name: p.name,
    price: p.price,
    currency: p.currency,
    billing: p.billing,
    limits: p.limits,
    features: p.features,
    trialDays: p.trialDays,
  }));
}

module.exports = {
  PLANS,
  getWorkspacePlan,
  getWorkspaceUsage,
  incrementUsage,
  checkLimit,
  checkFeature,
  setWorkspacePlan,
  startTrial,
  cancelPlan,
  getPlanSummary,
  getAllPlans,
};
