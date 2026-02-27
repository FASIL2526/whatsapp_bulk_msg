/* ─── Audit Log Service ─────────────────────────────────────────────────────
 *  Track admin/user actions for accountability and compliance.
 *  Stored per-workspace with automatic rotation.
 * ─────────────────────────────────────────────────────────────────────────── */

const { saveStore, getUserById } = require("../models/store");

const MAX_AUDIT_ENTRIES = 5000;

function ensureAuditLog(workspace) {
  if (!Array.isArray(workspace.auditLog)) workspace.auditLog = [];
}

/**
 * Log an action to the workspace audit trail.
 * @param {object} workspace
 * @param {string} userId - Who performed the action
 * @param {string} action - Action type (e.g. "lead.delete", "config.update", "campaign.send")
 * @param {object} details - Additional context
 */
function logAction(workspace, userId, action, details = {}) {
  ensureAuditLog(workspace);
  const user = getUserById(userId);
  workspace.auditLog.push({
    id: `aud_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`,
    userId,
    username: user?.username || "system",
    action,
    details: typeof details === "object" ? details : { info: String(details) },
    timestamp: new Date().toISOString(),
  });

  // Rotate old entries
  if (workspace.auditLog.length > MAX_AUDIT_ENTRIES) {
    workspace.auditLog = workspace.auditLog.slice(-MAX_AUDIT_ENTRIES);
  }
  saveStore();
}

/** Get audit log entries with optional filtering */
function getAuditLog(workspace, { action, userId, limit = 100, offset = 0 } = {}) {
  ensureAuditLog(workspace);
  let entries = [...workspace.auditLog].reverse();
  if (action) entries = entries.filter(e => e.action === action || e.action.startsWith(action + "."));
  if (userId) entries = entries.filter(e => e.userId === userId);
  return {
    total: entries.length,
    entries: entries.slice(offset, offset + limit),
  };
}

/** Get list of all unique action types in the log */
function getActionTypes(workspace) {
  ensureAuditLog(workspace);
  return [...new Set(workspace.auditLog.map(e => e.action))].sort();
}

module.exports = {
  ensureAuditLog,
  logAction,
  getAuditLog,
  getActionTypes,
};
