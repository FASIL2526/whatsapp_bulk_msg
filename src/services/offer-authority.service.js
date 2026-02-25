/* ─── Offer Authority Service ───────────────────────────────────────────────
 *  Gives the AI agent authority to make pricing decisions within
 *  operator-defined guardrails. The agent can offer discounts,
 *  payment plans, and time-limited deals autonomously.
 * ─────────────────────────────────────────────────────────────────────────── */

const { saveStore, appendReport } = require("../models/store");
const { DEFAULT_CONFIG } = require("../config/default-config");
const { sanitizeText } = require("../utils/workspace-config");

// ─── Guardrail evaluation ──────────────────────────────────────────────────
function getOfferGuardrails(workspace) {
  const config = workspace.config || DEFAULT_CONFIG;
  return {
    enabled: config.OFFER_AUTHORITY_ENABLED === "true",
    maxDiscountPct: Math.min(50, Math.max(0, Number(config.OFFER_MAX_DISCOUNT_PCT || "15"))),
    minLeadScore: Math.max(0, Number(config.OFFER_MIN_LEAD_SCORE || "60")),
    basePrice: Number(config.OFFER_BASE_PRICE || "0"),
    currency: sanitizeText(config.OFFER_CURRENCY, "USD"),
    allowPaymentPlan: config.OFFER_ALLOW_PAYMENT_PLAN === "true",
    maxOffersPerLead: Math.max(1, Number(config.OFFER_MAX_PER_LEAD || "2")),
    urgencyWindow: sanitizeText(config.OFFER_URGENCY_WINDOW, "48 hours"),
  };
}

// ─── Determine offer for a lead ────────────────────────────────────────────
function computeOffer(workspace, lead) {
  const guardrails = getOfferGuardrails(workspace);
  if (!guardrails.enabled || guardrails.basePrice <= 0) return null;

  const score = lead.score || 0;
  if (score < guardrails.minLeadScore) return null;

  // Check how many offers this lead already received
  const offerLog = workspace._offerLog || [];
  const leadOffers = offerLog.filter(o => o.leadId === lead.id);
  if (leadOffers.length >= guardrails.maxOffersPerLead) return null;

  const status = (lead.status || "cold").toLowerCase();
  const hasObjection = Boolean(lead.primaryObjection);
  const objectionType = (lead.primaryObjection || "").toLowerCase();

  // Calculate discount based on context
  let discountPct = 0;
  let reason = "";
  let strategy = "standard";

  // Price objection → maximum discount
  if (hasObjection && (objectionType.includes("price") || objectionType.includes("expensive") || objectionType.includes("budget"))) {
    discountPct = guardrails.maxDiscountPct;
    reason = "Price objection detected — offering best available discount";
    strategy = "price_objection_counter";
  }
  // Hot lead, high score → moderate incentive to close fast
  else if (status === "hot" && score >= 80) {
    discountPct = Math.round(guardrails.maxDiscountPct * 0.5);
    reason = "High-intent lead — offering closing incentive";
    strategy = "close_incentive";
  }
  // Warm lead stalling → small discount to re-engage
  else if (status === "warm" && score >= 50) {
    discountPct = Math.round(guardrails.maxDiscountPct * 0.3);
    reason = "Warm lead showing interest — offering engagement incentive";
    strategy = "engagement_nudge";
  }
  // Timing objection → urgency play
  else if (hasObjection && (objectionType.includes("later") || objectionType.includes("timing") || objectionType.includes("not now"))) {
    discountPct = Math.round(guardrails.maxDiscountPct * 0.6);
    reason = "Timing objection — offering limited-time deal";
    strategy = "urgency_counter";
  }
  else {
    return null; // No offer warranted
  }

  discountPct = Math.min(discountPct, guardrails.maxDiscountPct);
  const discountedPrice = Math.round(guardrails.basePrice * (1 - discountPct / 100));
  const savings = guardrails.basePrice - discountedPrice;

  const offer = {
    leadId: lead.id,
    leadName: lead.name || lead.id?.split("@")[0] || "there",
    strategy,
    reason,
    originalPrice: guardrails.basePrice,
    discountPct,
    discountedPrice,
    savings,
    currency: guardrails.currency,
    urgencyWindow: guardrails.urgencyWindow,
    paymentPlanAvailable: guardrails.allowPaymentPlan,
  };

  return offer;
}

// ─── Build the offer message ──────────────────────────────────────────────
function buildOfferMessage(offer) {
  if (!offer) return null;

  const name = offer.leadName;
  const curr = offer.currency;

  if (offer.strategy === "price_objection_counter") {
    return `${name}, I completely understand budget is a factor. I've been able to secure a special rate for you: *${curr} ${offer.discountedPrice}* instead of ${curr} ${offer.originalPrice} — that's ${offer.discountPct}% off (saving ${curr} ${offer.savings}). This is available for the next ${offer.urgencyWindow}. ${offer.paymentPlanAvailable ? "We can also split this into a payment plan if that helps." : ""} Want to lock this in?`;
  }

  if (offer.strategy === "close_incentive") {
    return `Great news, ${name}! Since you're ready to move forward, I can offer you an exclusive rate: *${curr} ${offer.discountedPrice}* (${offer.discountPct}% off). This special pricing is available for ${offer.urgencyWindow}. Ready to get started?`;
  }

  if (offer.strategy === "urgency_counter") {
    return `Hey ${name}, I totally get the timing. Here's what I can do — if you decide within ${offer.urgencyWindow}, I can lock in *${curr} ${offer.discountedPrice}* instead of ${curr} ${offer.originalPrice}. That way you save ${curr} ${offer.savings} and still get started on your timeline. Sound fair?`;
  }

  if (offer.strategy === "engagement_nudge") {
    return `Hi ${name}! I wanted to share something — we have a limited offer at *${curr} ${offer.discountedPrice}* (normally ${curr} ${offer.originalPrice}). Happy to answer any questions before you decide!`;
  }

  return null;
}

// ─── Log an offer ──────────────────────────────────────────────────────────
function logOffer(workspace, offer) {
  if (!workspace._offerLog) workspace._offerLog = [];
  workspace._offerLog.push({
    ...offer,
    offeredAt: new Date().toISOString(),
    accepted: null, // set later
  });
  // Keep log manageable
  if (workspace._offerLog.length > 500) {
    workspace._offerLog = workspace._offerLog.slice(-500);
  }
  saveStore();
  appendReport(workspace, {
    kind: "offer_made",
    source: "offer_authority",
    ok: true,
    leadId: offer.leadId,
    strategy: offer.strategy,
    discountPct: offer.discountPct,
    price: offer.discountedPrice,
  });
}

// ─── Mark offer as accepted / rejected ─────────────────────────────────────
function resolveOffer(workspace, leadId, accepted) {
  const log = workspace._offerLog || [];
  const last = [...log].reverse().find(o => o.leadId === leadId && o.accepted === null);
  if (last) {
    last.accepted = Boolean(accepted);
    last.resolvedAt = new Date().toISOString();
    saveStore();
  }
  return last || null;
}

// ─── Analytics ─────────────────────────────────────────────────────────────
function getOfferStats(workspace) {
  const log = workspace._offerLog || [];
  const total = log.length;
  const accepted = log.filter(o => o.accepted === true).length;
  const rejected = log.filter(o => o.accepted === false).length;
  const pending = log.filter(o => o.accepted === null).length;
  const acceptRate = total > 0 ? Math.round((accepted / total) * 100) : 0;
  const totalSavings = log.filter(o => o.accepted === true)
    .reduce((s, o) => s + (o.savings || 0), 0);
  const totalRevenue = log.filter(o => o.accepted === true)
    .reduce((s, o) => s + (o.discountedPrice || 0), 0);

  // Best performing strategy
  const stratStats = {};
  for (const o of log) {
    if (!stratStats[o.strategy]) stratStats[o.strategy] = { total: 0, accepted: 0 };
    stratStats[o.strategy].total++;
    if (o.accepted === true) stratStats[o.strategy].accepted++;
  }
  const bestStrategy = Object.entries(stratStats)
    .map(([s, d]) => ({ strategy: s, ...d, rate: d.total > 0 ? Math.round((d.accepted / d.total) * 100) : 0 }))
    .sort((a, b) => b.rate - a.rate)[0] || null;

  return { total, accepted, rejected, pending, acceptRate, totalSavings, totalRevenue, bestStrategy, currency: log[0]?.currency || "USD" };
}

module.exports = {
  getOfferGuardrails,
  computeOffer,
  buildOfferMessage,
  logOffer,
  resolveOffer,
  getOfferStats,
};
