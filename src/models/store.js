/* ─── Data Store ───────────────────────────────────────────────────────────
 *  In-memory store, persistence, user CRUD, workspace helpers,
 *  runtime map, report helper, and booking-model normalisers.
 * ─────────────────────────────────────────────────────────────────────────── */

const fs = require("fs");
const bcrypt = require("bcryptjs");
const {
  DATA_DIR,
  STORE_PATH,
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
  return { id: user.id, username: user.username, createdAt: user.createdAt };
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
    admin = {
      id: `u_${Date.now().toString(36)}`,
      username: adminUsername,
      passwordHash: bcrypt.hashSync(adminPassword, 10),
      createdAt: new Date().toISOString(),
    };
    store.users.push(admin);
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

// ─── Persistence ───────────────────────────────────────────────────────────
function saveStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
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

  if (fs.existsSync(STORE_PATH)) {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    store.users = Array.isArray(parsed.users) ? parsed.users : [];
    store.workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
  }

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
          uploadedAt: sanitizeText(m.uploadedAt, new Date().toISOString()),
        }))
      : [];

    if (JSON.stringify(normalizedConfig) !== JSON.stringify(workspace.config || {})) changed = true;
    if (!Array.isArray(workspace.reports)) changed = true;
    if (!Array.isArray(workspace.members)) changed = true;
    if (!Array.isArray(workspace.leads)) changed = true;
    if (!Array.isArray(workspace.bookings)) changed = true;
    if (!Array.isArray(workspace.scheduledMessages)) changed = true;
    if (!Array.isArray(workspace.media)) changed = true;
    if (normalizedMembers.length === 0) {
      normalizedMembers.push({ userId: adminUser.id, role: "owner" });
      changed = true;
    }

    return {
      ...workspace,
      config: normalizedConfig,
      reports: normalizedReports,
      members: normalizedMembers,
      leads: normalizedLeads,
      bookings: normalizedBookings,
      scheduledMessages: normalizedScheduled,
      media: normalizedMedia,
      // ─── SaaS fields (safe migration) ─────────────────────────────────
      plan: workspace.plan || { id: "free", name: "Free", status: "active", startedAt: new Date().toISOString() },
      _usage: workspace._usage || { messagesSent: 0, aiCalls: 0, cycleStart: new Date().toISOString(), cycleResetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString() },
    };
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
};
