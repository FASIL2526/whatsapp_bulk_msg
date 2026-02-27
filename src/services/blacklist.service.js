/* ─── Blacklist / DND Service ───────────────────────────────────────────────
 *  Manage Do-Not-Disturb list — numbers that should never receive messages.
 *  Supports manual add/remove, CSV import, and auto opt-out detection.
 * ─────────────────────────────────────────────────────────────────────────── */

const { saveStore } = require("../models/store");
const { normalizeRecipients } = require("../utils/workspace-config");

function ensureBlacklist(workspace) {
  if (!Array.isArray(workspace.blacklist)) workspace.blacklist = [];
}

/** Normalize a phone number for blacklist matching */
function normalizeNumber(raw) {
  return String(raw || "").replace(/[^0-9]/g, "");
}

/** Check if a chatId or number is blacklisted */
function isBlacklisted(workspace, chatIdOrNumber) {
  ensureBlacklist(workspace);
  const num = normalizeNumber(chatIdOrNumber.replace("@c.us", "").replace("@g.us", ""));
  if (!num) return false;
  return workspace.blacklist.some(entry => entry.number === num);
}

/** Add numbers to blacklist. Returns count of newly added. */
function addToBlacklist(workspace, numbers, reason = "manual") {
  ensureBlacklist(workspace);
  let added = 0;
  const normalized = (Array.isArray(numbers) ? numbers : [numbers])
    .map(n => normalizeNumber(n))
    .filter(Boolean);

  for (const num of normalized) {
    if (!workspace.blacklist.some(e => e.number === num)) {
      workspace.blacklist.push({
        number: num,
        reason,
        addedAt: new Date().toISOString(),
      });
      added++;
    }
  }
  if (added > 0) saveStore();
  return added;
}

/** Remove numbers from blacklist. Returns count removed. */
function removeFromBlacklist(workspace, numbers) {
  ensureBlacklist(workspace);
  const toRemove = new Set(
    (Array.isArray(numbers) ? numbers : [numbers])
      .map(n => normalizeNumber(n))
      .filter(Boolean)
  );
  const before = workspace.blacklist.length;
  workspace.blacklist = workspace.blacklist.filter(e => !toRemove.has(e.number));
  const removed = before - workspace.blacklist.length;
  if (removed > 0) saveStore();
  return removed;
}

/** Get full blacklist */
function getBlacklist(workspace) {
  ensureBlacklist(workspace);
  return workspace.blacklist;
}

/** Import numbers from CSV text (one per line or comma-separated) */
function importBlacklist(workspace, csvText, reason = "csv_import") {
  const numbers = normalizeRecipients(csvText);
  return addToBlacklist(workspace, numbers, reason);
}

/** Detect opt-out keywords in a message */
const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "opt out", "opt-out", "remove me", "don't message", "dont message", "block"];
function isOptOutMessage(text) {
  const lower = String(text || "").toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower === kw || lower.startsWith(kw + " ") || lower.endsWith(" " + kw));
}

/** Filter recipients list removing blacklisted numbers */
function filterBlacklisted(workspace, chatIds) {
  ensureBlacklist(workspace);
  return chatIds.filter(id => !isBlacklisted(workspace, id));
}

module.exports = {
  ensureBlacklist,
  isBlacklisted,
  addToBlacklist,
  removeFromBlacklist,
  getBlacklist,
  importBlacklist,
  isOptOutMessage,
  filterBlacklisted,
  normalizeNumber,
};
