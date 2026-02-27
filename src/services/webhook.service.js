/* ─── Webhook Service ──────────────────────────────────────────────────────
 *  Outgoing webhook/Zapier integration.
 *  Fire events to external URLs when things happen in the workspace.
 * ─────────────────────────────────────────────────────────────────────────── */

const { saveStore } = require("../models/store");
const { sanitizeText } = require("../utils/workspace-config");

const WEBHOOK_EVENTS = [
  "lead.created",
  "lead.updated",
  "lead.status_changed",
  "lead.stage_changed",
  "message.sent",
  "message.received",
  "campaign.sent",
  "campaign.completed",
  "booking.created",
  "booking.confirmed",
  "booking.cancelled",
  "opt_out",
  "escalation",
];

function ensureWebhooks(workspace) {
  if (!Array.isArray(workspace.webhooks)) workspace.webhooks = [];
}

/** Add a webhook endpoint */
function addWebhook(workspace, { url, events, name, secret }) {
  ensureWebhooks(workspace);
  const webhook = {
    id: `wh_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`,
    name: sanitizeText(name, "Webhook"),
    url: sanitizeText(url, ""),
    events: Array.isArray(events) ? events.filter(e => WEBHOOK_EVENTS.includes(e)) : WEBHOOK_EVENTS,
    secret: sanitizeText(secret, ""),
    enabled: true,
    createdAt: new Date().toISOString(),
    lastFiredAt: "",
    lastStatus: "",
    fireCount: 0,
    failCount: 0,
  };
  if (!webhook.url) throw new Error("Webhook URL is required.");
  workspace.webhooks.push(webhook);
  saveStore();
  return webhook;
}

/** Update a webhook */
function updateWebhook(workspace, webhookId, updates) {
  ensureWebhooks(workspace);
  const wh = workspace.webhooks.find(w => w.id === webhookId);
  if (!wh) throw new Error("Webhook not found.");
  if (updates.name !== undefined) wh.name = sanitizeText(updates.name, wh.name);
  if (updates.url !== undefined) wh.url = sanitizeText(updates.url, wh.url);
  if (updates.events !== undefined) wh.events = Array.isArray(updates.events) ? updates.events.filter(e => WEBHOOK_EVENTS.includes(e)) : wh.events;
  if (updates.secret !== undefined) wh.secret = sanitizeText(updates.secret, wh.secret);
  if (updates.enabled !== undefined) wh.enabled = !!updates.enabled;
  saveStore();
  return wh;
}

/** Remove a webhook */
function removeWebhook(workspace, webhookId) {
  ensureWebhooks(workspace);
  const idx = workspace.webhooks.findIndex(w => w.id === webhookId);
  if (idx === -1) return false;
  workspace.webhooks.splice(idx, 1);
  saveStore();
  return true;
}

/** List webhooks */
function listWebhooks(workspace) {
  ensureWebhooks(workspace);
  return workspace.webhooks;
}

/**
 * Fire a webhook event — POST data to all matching webhook URLs.
 * Runs async and doesn't block the caller.
 */
function fireWebhookEvent(workspace, event, data = {}) {
  ensureWebhooks(workspace);
  const matching = workspace.webhooks.filter(w => w.enabled && w.events.includes(event));
  if (matching.length === 0) return;

  const payload = {
    event,
    workspace: workspace.id,
    timestamp: new Date().toISOString(),
    data,
  };

  for (const wh of matching) {
    const headers = { "Content-Type": "application/json" };
    if (wh.secret) headers["X-Webhook-Secret"] = wh.secret;

    fetch(wh.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    })
      .then(res => {
        wh.lastFiredAt = new Date().toISOString();
        wh.lastStatus = `${res.status} ${res.statusText}`;
        wh.fireCount = (wh.fireCount || 0) + 1;
        saveStore();
      })
      .catch(err => {
        wh.lastFiredAt = new Date().toISOString();
        wh.lastStatus = `error: ${err.message}`;
        wh.failCount = (wh.failCount || 0) + 1;
        saveStore();
        console.error(`[WEBHOOK] ❌ ${wh.name} failed for ${event}: ${err.message}`);
      });
  }
}

module.exports = {
  WEBHOOK_EVENTS,
  ensureWebhooks,
  addWebhook,
  updateWebhook,
  removeWebhook,
  listWebhooks,
  fireWebhookEvent,
};
