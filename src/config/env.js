/* ─── Environment Configuration ────────────────────────────────────────────
 *  All env-derived constants live here.
 *  NOTE: require("dotenv").config() must be called in the entry-point
 *        BEFORE this module is imported.
 * ─────────────────────────────────────────────────────────────────────────── */

const path = require("path");
const { sanitizeText } = require("../utils/workspace-config");

const PROJECT_ROOT = path.join(__dirname, "..", "..");

const PORT = Number(process.env.PORT || 4000);
const HOST =
  process.env.HOST ||
  (process.env.NODE_ENV === "production" || process.env.RENDER === "true"
    ? "0.0.0.0"
    : "127.0.0.1");

const DATA_DIR = path.join(PROJECT_ROOT, "data");
const STORE_PATH = path.join(DATA_DIR, "workspaces.json");
const STORE_TEMP_PATH = path.join(DATA_DIR, "workspaces.tmp.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const BACKUP_MAX = Math.max(5, Number(process.env.BACKUP_MAX || 50));
const BACKUP_INTERVAL_MS = Math.max(60000, Number(process.env.BACKUP_INTERVAL_MINUTES || 60) * 60000);
const MAX_REPORT_ENTRIES = 5000;

const AUTH_SECRET = process.env.AUTH_SECRET || "restartx-dev-secret-change-me";
const TOKEN_TTL = process.env.TOKEN_TTL || "7d";

// ─── Booking / Google Calendar ─────────────────────────────────────────────
const BOOKING_ENABLED = process.env.BOOKING_ENABLED === "true";
const GOOGLE_CLIENT_ID = sanitizeText(process.env.GOOGLE_CLIENT_ID, "");
const GOOGLE_CLIENT_SECRET = sanitizeText(process.env.GOOGLE_CLIENT_SECRET, "");
const GOOGLE_REDIRECT_URI = sanitizeText(process.env.GOOGLE_REDIRECT_URI, "");
const GOOGLE_REFRESH_TOKEN = sanitizeText(process.env.GOOGLE_REFRESH_TOKEN, "");
const GOOGLE_CALENDAR_ID = sanitizeText(process.env.GOOGLE_CALENDAR_ID, "primary");

const BOOKING_SLOT_MINUTES = Math.max(
  15,
  Number.parseInt(String(process.env.BOOKING_SLOT_MINUTES || "30"), 10) || 30
);
const BOOKING_LOOKAHEAD_DAYS = Math.max(
  1,
  Number.parseInt(String(process.env.BOOKING_LOOKAHEAD_DAYS || "14"), 10) || 14
);
const BOOKING_BUFFER_MINUTES = Math.max(
  0,
  Number.parseInt(String(process.env.BOOKING_BUFFER_MINUTES || "15"), 10) || 15
);
const BOOKING_WORK_START = sanitizeText(process.env.BOOKING_WORK_START, "09:00");
const BOOKING_WORK_END = sanitizeText(process.env.BOOKING_WORK_END, "18:00");
const BOOKING_TIMEZONE = sanitizeText(process.env.BOOKING_TIMEZONE, "UTC");

const BOOKING_REMINDER_MINUTES = String(process.env.BOOKING_REMINDER_MINUTES || "1440,60,10")
  .split(",")
  .map((v) => Number.parseInt(v.trim(), 10))
  .filter((v) => Number.isFinite(v) && v >= 0)
  .sort((a, b) => b - a);

const BOOKING_NO_SHOW_GRACE_MINUTES = Math.max(
  0,
  Number.parseInt(String(process.env.BOOKING_NO_SHOW_GRACE_MINUTES || "20"), 10) || 20
);
const BOOKING_REBOOK_ENABLED = process.env.BOOKING_REBOOK_ENABLED !== "false";

const SERVER_STARTED_AT = new Date().toLocaleString();

module.exports = {
  PROJECT_ROOT,
  PORT,
  HOST,
  DATA_DIR,
  STORE_PATH,
  STORE_TEMP_PATH,
  BACKUP_DIR,
  BACKUP_MAX,
  BACKUP_INTERVAL_MS,
  MAX_REPORT_ENTRIES,
  AUTH_SECRET,
  TOKEN_TTL,
  BOOKING_ENABLED,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_REFRESH_TOKEN,
  GOOGLE_CALENDAR_ID,
  BOOKING_SLOT_MINUTES,
  BOOKING_LOOKAHEAD_DAYS,
  BOOKING_BUFFER_MINUTES,
  BOOKING_WORK_START,
  BOOKING_WORK_END,
  BOOKING_TIMEZONE,
  BOOKING_REMINDER_MINUTES,
  BOOKING_NO_SHOW_GRACE_MINUTES,
  BOOKING_REBOOK_ENABLED,
  SERVER_STARTED_AT,
};
