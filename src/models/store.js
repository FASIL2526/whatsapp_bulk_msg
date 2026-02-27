/* ─── Data Store ───────────────────────────────────────────────────────────
 *  In-memory store, persistence, user CRUD, workspace helpers,
 *  runtime map, report helper, and booking-model normalisers.
 * ─────────────────────────────────────────────────────────────────────────── */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const {
  DATA_DIR,
  STORE_PATH,
  STORE_TEMP_PATH,
  BACKUP_DIR,
  BACKUP_MAX,
  BACKUP_INTERVAL_MS,
  MAX_REPORT_ENTRIES,
  BOOKING_REMINDER_MINUTES,
  BOOKING_TIMEZONE,
} = require("../config/env");
const { DEFAULT_CONFIG } = require("../config/default-config");
const {
  normalizeRecipients,
  sanitizeText,
  sanitizeMultilineText,
  sanitizeChoice,
  sanitizeWorkspaceConfig,
} = require("../utils/workspace-config");

// ─── In-memory data ────────────────────────────────────────────────────────
const store = { users: [], workspaces: [] };
const runtimeByWorkspaceId = new Map();
let followUpSweepInProgress = false;

const ROLE_RANK = { member: 1, admin: 2, owner: 3 };

// ─── User helpers ──────────────────────────────────────────────────────────
function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

function safeUser(user) {
  return { id: user.id, username: user.username, plan: user.plan, createdAt: user.createdAt };
}

function getUserById(userId) {
  return store.users.find((u) => u.id === userId);
}

function getUserByUsername(username) {
  return store.users.find((u) => u.username === username);
}

function ensureBootstrapAdmin() {
  const adminUsername = normalizeUsername(process.env.ADMIN_USERNAME || "admin");
  const adminPassword = String(process.env.ADMIN_PASSWORD || "admin12345");
  if (!adminUsername) {
    throw new Error("Invalid ADMIN_USERNAME");
  }
  let admin = getUserByUsername(adminUsername);
  if (!admin) {
    const now = new Date();
    admin = {
      id: `u_${Date.now().toString(36)}`,
      username: adminUsername,
      passwordHash: bcrypt.hashSync(adminPassword, 10),
      plan: { id: "free", name: "Free", status: "active", startedAt: now.toISOString() },
      _usage: { messagesSent: 0, aiCalls: 0, cycleStart: now.toISOString(), cycleResetAt: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() },
      createdAt: now.toISOString(),
    };
    store.users.push(admin);
  } else {
    // Migrate existing admin user
    if (!admin.plan) {
      admin.plan = { id: "free", name: "Free", status: "active", startedAt: new Date().toISOString() };
    }
    if (!admin._usage) {
      const now = new Date();
      admin._usage = { messagesSent: 0, aiCalls: 0, cycleStart: now.toISOString(), cycleResetAt: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() };
    }
  }
  return admin;
}

// ─── Workspace helpers ─────────────────────────────────────────────────────
function workspaceMember(workspace, userId) {
  const members = Array.isArray(workspace.members) ? workspace.members : [];
  return members.find((m) => m.userId === userId) || null;
}

function hasWorkspaceRole(workspace, userId, minRole = "member") {
  const member = workspaceMember(workspace, userId);
  if (!member) return false;
  return (ROLE_RANK[member.role] || 0) >= (ROLE_RANK[minRole] || 0);
}

function toWorkspaceId(input) {
  const normalized = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || `ws-${Date.now().toString(36)}`;
}

function getWorkspace(workspaceId) {
  return store.workspaces.find((ws) => ws.id === workspaceId);
}

function workspaceRecipientsChatIds(workspace) {
  return normalizeRecipients(workspace.config.RECIPIENTS || "").map((num) => `${num}@c.us`);
}

// ─── Persistence (atomic write + auto-backup) ─────────────────────────────
let _saveCounter = 0;
let _lastBackupAt = null;
let _backupTimer = null;

/**
 * Atomic save: write to temp file first, then rename.
 * This prevents half-written / corrupt JSON on crash.
 */
function saveStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const json = `${JSON.stringify(store, null, 2)}\n`;

  // 1) Validate the JSON we're about to write (sanity check)
  try {
    JSON.parse(json);
  } catch {
    console.error("[STORE] ❌ REFUSING to save — serialised JSON is invalid. This should never happen.");
    return;
  }

  // 2) Write to temp file first
  fs.writeFileSync(STORE_TEMP_PATH, json, "utf8");

  // 3) Atomic rename (overwrites old file safely)
  fs.renameSync(STORE_TEMP_PATH, STORE_PATH);

  _saveCounter++;
}

/**
 * Create a timestamped backup copy of workspaces.json.
 * Rotates old backups to keep at most BACKUP_MAX files.
 */
function createBackup(label = "auto") {
  try {
    if (!fs.existsSync(STORE_PATH)) return null;

    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, "-");
    const filename = `workspaces_${ts}_${label}.json`;
    const backupPath = path.join(BACKUP_DIR, filename);

    fs.copyFileSync(STORE_PATH, backupPath);
    _lastBackupAt = now.toISOString();

    // Rotate: delete oldest if over limit
    rotateBackups();

    console.log(`[BACKUP] ✅ Created: ${filename}`);
    return { filename, path: backupPath, createdAt: _lastBackupAt, sizeBytes: fs.statSync(backupPath).size };
  } catch (err) {
    console.error("[BACKUP] ❌ Failed to create backup:", err.message);
    return null;
  }
}

/**
 * Keep only the newest BACKUP_MAX backups.
 */
function rotateBackups() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith("workspaces_") && f.endsWith(".json"))
      .sort();
    while (files.length > BACKUP_MAX) {
      const oldest = files.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, oldest)); } catch {}
    }
  } catch {}
}

/**
 * List all backup files with metadata.
 */
function listBackups() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith("workspaces_") && f.endsWith(".json"))
      .sort()
      .reverse()
      .map(filename => {
        const fullPath = path.join(BACKUP_DIR, filename);
        const stat = fs.statSync(fullPath);
        return { filename, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
      });
  } catch {
    return [];
  }
}

/**
 * Delete a specific backup file.
 */
function deleteBackup(filename) {
  // Prevent path traversal
  const safe = path.basename(filename);
  if (!safe.startsWith("workspaces_") || !safe.endsWith(".json")) return false;
  const fullPath = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(fullPath)) return false;
  fs.unlinkSync(fullPath);
  return true;
}

/**
 * Restore from a backup file — overwrites current workspaces.json and reloads into memory.
 * Creates a pre-restore backup first.
 */
function restoreFromBackup(filename) {
  const safe = path.basename(filename);
  const fullPath = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(fullPath)) throw new Error("Backup file not found.");

  // Validate the backup JSON before restoring
  const raw = fs.readFileSync(fullPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Backup file contains invalid JSON.");
  }
  if (!parsed || !Array.isArray(parsed.users) || !Array.isArray(parsed.workspaces)) {
    throw new Error("Backup file has invalid data structure (missing users or workspaces).");
  }

  // Create a pre-restore safety backup
  createBackup("pre-restore");

  // Overwrite current store
  store.users = parsed.users;
  store.workspaces = parsed.workspaces;
  saveStore();

  return { users: store.users.length, workspaces: store.workspaces.length };
}

/**
 * Try loading store from main file, fallback to latest backup if corrupt.
 */
function loadStoreWithRecovery() {
  // Try main file first
  if (fs.existsSync(STORE_PATH)) {
    try {
      const raw = fs.readFileSync(STORE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.workspaces)) {
        store.users = parsed.users;
        store.workspaces = parsed.workspaces;
        console.log(`[STORE] ✅ Loaded ${store.users.length} users, ${store.workspaces.length} workspaces`);
        return true;
      }
    } catch (err) {
      console.error("[STORE] ⚠️ Main file corrupted:", err.message);
    }
  }

  // Fallback: try latest backup
  console.log("[STORE] 🔄 Attempting recovery from backup...");
  const backups = listBackups();
  for (const bk of backups) {
    try {
      const raw = fs.readFileSync(path.join(BACKUP_DIR, bk.filename), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.workspaces)) {
        store.users = parsed.users;
        store.workspaces = parsed.workspaces;
        // Re-save recovered data to main file
        saveStore();
        console.log(`[STORE] ✅ RECOVERED from backup: ${bk.filename} (${store.users.length} users, ${store.workspaces.length} workspaces)`);
        return true;
      }
    } catch {}
  }

  console.log("[STORE] ℹ️ No valid data found — starting fresh.");
  return false;
}

/**
 * Get backup system status.
 */
function getBackupStatus() {
  const backups = listBackups();
  const totalBytes = backups.reduce((sum, b) => sum + b.sizeBytes, 0);
  const mainSize = fs.existsSync(STORE_PATH) ? fs.statSync(STORE_PATH).size : 0;
  return {
    enabled: true,
    maxBackups: BACKUP_MAX,
    backupIntervalMinutes: BACKUP_INTERVAL_MS / 60000,
    totalBackups: backups.length,
    totalBackupSizeMB: +(totalBytes / 1024 / 1024).toFixed(2),
    mainFileSizeMB: +(mainSize / 1024 / 1024).toFixed(2),
    lastBackupAt: _lastBackupAt,
    savesSinceStart: _saveCounter,
    latestBackup: backups[0] || null,
  };
}

/**
 * Start periodic auto-backup timer.
 */
function startAutoBackup() {
  if (_backupTimer) clearInterval(_backupTimer);
  // Initial backup on startup
  createBackup("startup");
  _backupTimer = setInterval(() => createBackup("scheduled"), BACKUP_INTERVAL_MS);
  console.log(`[BACKUP] ⏱️ Auto-backup every ${BACKUP_INTERVAL_MS / 60000} min (max ${BACKUP_MAX} kept)`);
}

/**
 * Stop periodic auto-backup timer.
 */
function stopAutoBackup() {
  if (_backupTimer) {
    clearInterval(_backupTimer);
    _backupTimer = null;
  }
}

// ─── Booking model helpers (needed by ensureStore) ─────────────────────────
function parseReminderList(raw) {
  return String(raw || "")
    .split(",")
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => b - a);
}

function bookingTimezone(input) {
  return sanitizeText(input, BOOKING_TIMEZONE) || "UTC";
}

function initBookingRecord(input) {
  const reminderMinutes =
    parseReminderList(input.reminderMinutes).length > 0
      ? parseReminderList(input.reminderMinutes)
      : BOOKING_REMINDER_MINUTES;
  return {
    id: input.id || `bk_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`,
    leadId: sanitizeText(input.leadId, ""),
    leadName: sanitizeText(input.leadName, ""),
    timezone: bookingTimezone(input.timezone),
    status: sanitizeChoice(
      sanitizeText(input.status, "pending"),
      ["pending", "confirmed", "cancelled", "completed", "no_show"],
      "pending"
    ),
    startAt: sanitizeText(input.startAt, ""),
    endAt: sanitizeText(input.endAt, ""),
    calendarEventId: sanitizeText(input.calendarEventId, ""),
    meetingLink: sanitizeText(input.meetingLink, ""),
    notes: sanitizeText(input.notes, ""),
    reminders: reminderMinutes.map((minutesBefore) => ({ minutesBefore, sentAt: "" })),
    noShowSentAt: "",
    lastIntentAt: sanitizeText(input.lastIntentAt, ""),
    createdAt: sanitizeText(input.createdAt, new Date().toISOString()),
    updatedAt: sanitizeText(input.updatedAt, new Date().toISOString()),
  };
}

function normalizeWorkspaceBookingRecord(raw) {
  const normalized = initBookingRecord({
    ...raw,
    id: raw?.id,
    status: raw?.status || "pending",
    reminderMinutes: (Array.isArray(raw?.reminders)
      ? raw.reminders.map((r) => r.minutesBefore)
      : []
    ).join(","),
  });
  if (Array.isArray(raw?.reminders)) {
    const sentAtByMinutes = new Map(
      raw.reminders.map((item) => [
        Number.parseInt(String(item?.minutesBefore || 0), 10),
        sanitizeText(item?.sentAt, ""),
      ])
    );
    normalized.reminders = normalized.reminders.map((item) => ({
      ...item,
      sentAt: sentAtByMinutes.get(item.minutesBefore) || "",
    }));
  }
  normalized.noShowSentAt = sanitizeText(raw?.noShowSentAt, "");
  return normalized;
}

function ensureWorkspaceBookings(workspace) {
  if (!Array.isArray(workspace.bookings)) {
    workspace.bookings = [];
  }
}

function bookingById(workspace, bookingId) {
  ensureWorkspaceBookings(workspace);
  return workspace.bookings.find((item) => item.id === bookingId) || null;
}

// ─── Store initialisation ──────────────────────────────────────────────────
function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Load with corruption recovery (tries main file, then backups)
  loadStoreWithRecovery();

  const adminUser = ensureBootstrapAdmin();

  if (store.workspaces.length === 0) {
    store.workspaces.push({
      id: "default",
      name: "Default Workspace",
      config: sanitizeWorkspaceConfig({ ...DEFAULT_CONFIG, ...process.env }),
      reports: [],
      leads: [],
      bookings: [],
      scheduledMessages: [],
      media: [],
      campaigns: [],
      templates: [],
      blacklist: [],
      auditLog: [],
      webhooks: [],
      chatFlows: [],
      customFields: [],
      branding: {},
      members: [{ userId: adminUser.id, role: "owner" }],
      createdAt: new Date().toISOString(),
    });
    saveStore();
    return;
  }

  let changed = false;
  store.workspaces = store.workspaces.map((workspace) => {
    const normalizedConfig = sanitizeWorkspaceConfig({ ...DEFAULT_CONFIG, ...(workspace.config || {}) });
    const normalizedReports = Array.isArray(workspace.reports) ? workspace.reports : [];
    const normalizedMembers = Array.isArray(workspace.members) ? workspace.members : [];
    const normalizedLeads = Array.isArray(workspace.leads) ? workspace.leads : [];
    const normalizedBookings = Array.isArray(workspace.bookings)
      ? workspace.bookings.map((b) => normalizeWorkspaceBookingRecord(b))
      : [];
    const normalizedScheduled = Array.isArray(workspace.scheduledMessages)
      ? workspace.scheduledMessages.map((s) => ({
          id: s.id || `sm_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`,
          message: sanitizeMultilineText(s.message || "", ""),
          sendAt: sanitizeText(s.sendAt, ""),
          status: sanitizeChoice(
            s.status || "pending",
            ["pending", "sent", "failed", "cancelled"],
            "pending"
          ),
          mediaId: sanitizeText(s.mediaId, ""),
          createdAt: sanitizeText(s.createdAt, new Date().toISOString()),
          sentAt: sanitizeText(s.sentAt, ""),
        }))
      : [];
    const normalizedMedia = Array.isArray(workspace.media)
      ? workspace.media.map((m) => ({
          id: m.id || `m_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`,
          filename: sanitizeText(m.filename, ""),
          path: sanitizeText(m.path, ""),
          mimeType: sanitizeText(m.mimeType, ""),
          sizeBytes: Number(m.sizeBytes) || 0,
          uploadedAt: sanitizeText(m.uploadedAt, new Date().toISOString()),
        }))
      : [];
    const normalizedCampaigns = Array.isArray(workspace.campaigns) ? workspace.campaigns : [];
    const normalizedTemplates = Array.isArray(workspace.templates) ? workspace.templates : [];

    // ─── New feature arrays (v2) ─────────────────────────────────────────
    const normalizedBlacklist = Array.isArray(workspace.blacklist) ? workspace.blacklist : [];
    const normalizedAuditLog = Array.isArray(workspace.auditLog) ? workspace.auditLog : [];
    const normalizedWebhooks = Array.isArray(workspace.webhooks) ? workspace.webhooks : [];
    const normalizedChatFlows = Array.isArray(workspace.chatFlows) ? workspace.chatFlows : [];
    const normalizedCustomFields = Array.isArray(workspace.customFields) ? workspace.customFields : [];
    const normalizedBranding = (workspace.branding && typeof workspace.branding === "object") ? workspace.branding : {};

    // ─── Lead-level migration (team assignment, notes, tags, custom data) ──
    const migratedLeads = normalizedLeads.map(lead => {
      let lChanged = false;
      if (!Array.isArray(lead.tags)) { lead.tags = []; lChanged = true; }
      if (!Array.isArray(lead.internalNotes)) { lead.internalNotes = []; lChanged = true; }
      if (!lead.customData || typeof lead.customData !== "object") { lead.customData = {}; lChanged = true; }
      if (lead.assignedTo === undefined) { lead.assignedTo = ""; lChanged = true; }
      if (lead.language === undefined) { lead.language = ""; lChanged = true; }
      if (lChanged) changed = true;
      return lead;
    });

    if (JSON.stringify(normalizedConfig) !== JSON.stringify(workspace.config || {})) changed = true;
    if (!Array.isArray(workspace.reports)) changed = true;
    if (!Array.isArray(workspace.members)) changed = true;
    if (!Array.isArray(workspace.leads)) changed = true;
    if (!Array.isArray(workspace.bookings)) changed = true;
    if (!Array.isArray(workspace.scheduledMessages)) changed = true;
    if (!Array.isArray(workspace.media)) changed = true;
    if (!Array.isArray(workspace.campaigns)) changed = true;
    if (!Array.isArray(workspace.templates)) changed = true;
    if (!Array.isArray(workspace.blacklist)) changed = true;
    if (!Array.isArray(workspace.auditLog)) changed = true;
    if (!Array.isArray(workspace.webhooks)) changed = true;
    if (!Array.isArray(workspace.chatFlows)) changed = true;
    if (!Array.isArray(workspace.customFields)) changed = true;
    if (!workspace.branding || typeof workspace.branding !== "object") changed = true;
    if (normalizedMembers.length === 0) {
      normalizedMembers.push({ userId: adminUser.id, role: "owner" });
      changed = true;
    }

    return {
      ...workspace,
      config: normalizedConfig,
      reports: normalizedReports,
      members: normalizedMembers,
      leads: migratedLeads,
      bookings: normalizedBookings,
      scheduledMessages: normalizedScheduled,
      media: normalizedMedia,
      campaigns: normalizedCampaigns,
      templates: normalizedTemplates,
      blacklist: normalizedBlacklist,
      auditLog: normalizedAuditLog,
      webhooks: normalizedWebhooks,
      chatFlows: normalizedChatFlows,
      customFields: normalizedCustomFields,
      branding: normalizedBranding,
    };
  });

  // ─── Migrate plan & usage from workspace to user (safe migration) ────
  store.users.forEach((user) => {
    if (!user.plan) {
      user.plan = { id: "free", name: "Free", status: "active", startedAt: new Date().toISOString() };
      changed = true;
    }
    if (!user._usage) {
      const now = new Date();
      user._usage = { messagesSent: 0, aiCalls: 0, cycleStart: now.toISOString(), cycleResetAt: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() };
      changed = true;
    }
  });

  // Remove legacy plan/_usage from workspaces if present
  store.workspaces.forEach((ws) => {
    if (ws.plan || ws._usage) {
      delete ws.plan;
      delete ws._usage;
      changed = true;
    }
  });

  if (changed) saveStore();
}

// ─── Runtime management ────────────────────────────────────────────────────
function getRuntime(workspaceId) {
  if (!runtimeByWorkspaceId.has(workspaceId)) {
    runtimeByWorkspaceId.set(workspaceId, {
      status: "stopped",
      authenticated: false,
      ready: false,
      startRequestedAt: null,
      qrDataUrl: "",
      lastError: "",
      client: null,
      scheduler: null,
      statusScheduler: null,
      sendInProgress: false,
      sendStartedAt: null,
      historySyncedContacts: new Set(),
      bookingOfferByLeadId: new Map(),
    });
  }
  return runtimeByWorkspaceId.get(workspaceId);
}

// ─── Report helper ─────────────────────────────────────────────────────────
function appendReport(workspace, entry) {
  if (!Array.isArray(workspace.reports)) {
    workspace.reports = [];
  }
  workspace.reports.push({ at: new Date().toISOString(), ...entry });
  if (workspace.reports.length > MAX_REPORT_ENTRIES) {
    workspace.reports = workspace.reports.slice(-MAX_REPORT_ENTRIES);
  }
  saveStore();
}

// ─── Follow-up sweep flag ──────────────────────────────────────────────────
function getFollowUpSweepInProgress() {
  return followUpSweepInProgress;
}
function setFollowUpSweepInProgress(val) {
  followUpSweepInProgress = val;
}

module.exports = {
  store,
  saveStore,
  ensureStore,
  getWorkspace,
  getRuntime,
  appendReport,
  getUserById,
  getUserByUsername,
  ensureBootstrapAdmin,
  normalizeUsername,
  safeUser,
  workspaceMember,
  hasWorkspaceRole,
  toWorkspaceId,
  workspaceRecipientsChatIds,
  initBookingRecord,
  normalizeWorkspaceBookingRecord,
  ensureWorkspaceBookings,
  bookingById,
  bookingTimezone,
  parseReminderList,
  ROLE_RANK,
  getFollowUpSweepInProgress,
  setFollowUpSweepInProgress,
  // Backup system
  createBackup,
  listBackups,
  deleteBackup,
  restoreFromBackup,
  getBackupStatus,
  startAutoBackup,
  stopAutoBackup,
};
