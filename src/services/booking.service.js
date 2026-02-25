/* ─── Booking Service ──────────────────────────────────────────────────────
 *  Google Calendar integration, slot discovery, booking CRUD,
 *  reminder sweeps, and booking-intent handling.
 * ─────────────────────────────────────────────────────────────────────────── */

const { google } = require("googleapis");
const {
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
  BOOKING_NO_SHOW_GRACE_MINUTES,
  BOOKING_REBOOK_ENABLED,
  BOOKING_REMINDER_MINUTES,
} = require("../config/env");
const { sanitizeText } = require("../utils/workspace-config");
const { parseTimeParts } = require("../utils/helpers");
const {
  store,
  saveStore,
  getRuntime,
  appendReport,
  ensureWorkspaceBookings,
  bookingTimezone,
  initBookingRecord,
} = require("../models/store");
const { updateLeadStatus } = require("./lead.service");

// ─── Helpers ───────────────────────────────────────────────────────────────
function bookingApiReady() {
  return BOOKING_ENABLED && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN;
}

function bookingIntentFromText(text) {
  return /(book|booking|schedule|slot|appointment|call|meeting|demo)/i.test(String(text || "").toLowerCase());
}

function bookingLeadName(leadId, workspace, fallback = "there") {
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const lead = leads.find((item) => item.id === leadId);
  const name = sanitizeText(lead?.name, "").split(" ")[0];
  return name || fallback;
}

function formatSlotForHumans(isoStart, tz) {
  try {
    return new Date(isoStart).toLocaleString("en-US", {
      timeZone: bookingTimezone(tz),
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch (_err) {
    return new Date(isoStart).toISOString();
  }
}

function bookingReminderText(booking, leadFirstName, minutesBefore) {
  const when = formatSlotForHumans(booking.startAt, booking.timezone);
  const meetLink = booking.meetingLink ? ` Join: ${booking.meetingLink}` : "";
  if (minutesBefore >= 1440)
    return `Hi ${leadFirstName}, reminder for your call tomorrow at ${when}.${meetLink}`.trim();
  if (minutesBefore >= 60)
    return `Hi ${leadFirstName}, reminder: your call is in about ${Math.round(minutesBefore / 60)} hour(s) at ${when}.${meetLink}`.trim();
  return `Hi ${leadFirstName}, your call starts in ${minutesBefore} minutes (${when}).${meetLink}`.trim();
}

// ─── Google Calendar ───────────────────────────────────────────────────────
function ensureGoogleCalendarClient() {
  if (!bookingApiReady()) {
    throw new Error(
      "Booking API is not configured. Set BOOKING_ENABLED and Google Calendar credentials in .env."
    );
  }
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI || undefined
  );
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: "v3", auth: oauth2Client });
}

async function fetchBusyWindows(calendar, timeMinIso, timeMaxIso, timezone) {
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      timeZone: bookingTimezone(timezone),
      items: [{ id: GOOGLE_CALENDAR_ID }],
    },
  });
  const busy = response?.data?.calendars?.[GOOGLE_CALENDAR_ID]?.busy || [];
  return busy
    .map((entry) => ({ start: new Date(entry.start), end: new Date(entry.end) }))
    .filter((e) => !Number.isNaN(e.start.getTime()) && !Number.isNaN(e.end.getTime()));
}

function slotOverlapsBusy(slotStart, slotEnd, busyWindows) {
  return busyWindows.some((busy) => slotStart < busy.end && slotEnd > busy.start);
}

function localWorkdayStart(baseDate) {
  const dt = new Date(baseDate);
  const { hour, minute } = parseTimeParts(BOOKING_WORK_START, 9, 0);
  dt.setHours(hour, minute, 0, 0);
  return dt;
}

function localWorkdayEnd(baseDate) {
  const dt = new Date(baseDate);
  const { hour, minute } = parseTimeParts(BOOKING_WORK_END, 18, 0);
  dt.setHours(hour, minute, 0, 0);
  return dt;
}

async function findAvailableSlots({ timezone, limit = 8 }) {
  const tz = bookingTimezone(timezone);
  const calendar = ensureGoogleCalendarClient();
  const now = new Date();
  const until = new Date(now.getTime() + BOOKING_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  const busy = await fetchBusyWindows(calendar, now.toISOString(), until.toISOString(), tz);
  const slots = [];
  const bufferMs = BOOKING_BUFFER_MINUTES * 60 * 1000;
  const slotMs = BOOKING_SLOT_MINUTES * 60 * 1000;

  for (let dayOffset = 0; dayOffset <= BOOKING_LOOKAHEAD_DAYS; dayOffset += 1) {
    const day = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const start = localWorkdayStart(day);
    const end = localWorkdayEnd(day);
    for (let cursor = new Date(start); cursor < end; cursor = new Date(cursor.getTime() + slotMs)) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(slotStart.getTime() + slotMs);
      if (slotEnd > end || slotStart <= new Date(now.getTime() + bufferMs)) continue;
      if (slotOverlapsBusy(slotStart, slotEnd, busy)) continue;
      slots.push({ startAt: slotStart.toISOString(), endAt: slotEnd.toISOString(), timezone: tz });
      if (slots.length >= limit) return slots;
    }
  }
  return slots;
}

async function createCalendarBookingEvent({ leadName, leadId, startAt, endAt, notes, timezone }) {
  const calendar = ensureGoogleCalendarClient();
  const summaryName = sanitizeText(leadName, leadId || "Lead");
  const descriptionLines = [
    `Lead: ${summaryName}`,
    `Lead ID: ${sanitizeText(leadId, "")}`,
    notes ? `Notes: ${notes}` : "",
  ].filter(Boolean);

  const response = await calendar.events.insert({
    calendarId: GOOGLE_CALENDAR_ID,
    conferenceDataVersion: 1,
    requestBody: {
      summary: `Sales Call - ${summaryName}`,
      description: descriptionLines.join("\n"),
      start: { dateTime: new Date(startAt).toISOString(), timeZone: bookingTimezone(timezone) },
      end: { dateTime: new Date(endAt).toISOString(), timeZone: bookingTimezone(timezone) },
      conferenceData: {
        createRequest: {
          requestId: `meet_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });
  return response?.data || {};
}

async function cancelCalendarBookingEvent(eventId) {
  if (!eventId) return;
  const calendar = ensureGoogleCalendarClient();
  await calendar.events.patch({
    calendarId: GOOGLE_CALENDAR_ID,
    eventId,
    requestBody: { status: "cancelled" },
  });
}

// ─── Intent & live slot offer ──────────────────────────────────────────────
async function sendBookingIntentOptions(workspace, runtime, leadId, leadName, timezone) {
  if (!runtime.client || !runtime.ready) return { sent: false, reason: "client_not_ready", slots: [] };
  const slots = await findAvailableSlots({ timezone, limit: 3 });
  if (slots.length === 0) {
    const waitMsg =
      "I couldn't find open call slots right now. Please share your preferred time window and I will confirm manually.";
    await runtime.client.sendMessage(leadId, waitMsg);
    return { sent: true, reason: "no_slots", slots: [] };
  }
  const intro = `Great ${sanitizeText(leadName, "there")}, I can book your call. Here are the next available slots:`;
  const lines = slots.map((s, i) => `${i + 1}) ${formatSlotForHumans(s.startAt, s.timezone)}`);
  const prompt = "Reply with the slot number (1, 2, or 3) and I will confirm it.";
  await runtime.client.sendMessage(leadId, [intro, ...lines, prompt].join("\n"));
  return { sent: true, reason: "slots_sent", slots };
}

// ─── Reminder sweeps ───────────────────────────────────────────────────────
async function processWorkspaceBookingReminders(workspace) {
  if (!BOOKING_ENABLED) return false;
  ensureWorkspaceBookings(workspace);
  if (workspace.bookings.length === 0) return false;

  const runtime = getRuntime(workspace.id);
  if (!runtime.client || !runtime.ready) return false;

  const now = new Date();
  let changed = false;
  for (const booking of workspace.bookings) {
    if (booking.status !== "confirmed") continue;
    const start = new Date(booking.startAt || "");
    if (Number.isNaN(start.getTime())) continue;
    const leadId = sanitizeText(booking.leadId, "");
    if (!leadId) continue;
    const leadFirstName = sanitizeText(
      booking.leadName,
      bookingLeadName(leadId, workspace, "there")
    ).split(" ")[0];

    if (!Array.isArray(booking.reminders)) {
      booking.reminders = BOOKING_REMINDER_MINUTES.map((m) => ({ minutesBefore: m, sentAt: "" }));
      changed = true;
    }

    for (const reminder of booking.reminders) {
      if (!reminder || reminder.sentAt) continue;
      const minutesBefore = Number.parseInt(String(reminder.minutesBefore || 0), 10);
      if (!Number.isFinite(minutesBefore)) continue;
      const triggerAt = new Date(start.getTime() - minutesBefore * 60 * 1000);
      if (now < triggerAt) continue;
      try {
        const message = bookingReminderText(booking, leadFirstName || "there", minutesBefore);
        await runtime.client.sendMessage(leadId, message);
        reminder.sentAt = new Date().toISOString();
        booking.updatedAt = reminder.sentAt;
        appendReport(workspace, {
          kind: "booking_reminder",
          source: "booking_scheduler",
          ok: true,
          from: leadId,
          message,
          bookingId: booking.id,
        });
        changed = true;
      } catch (err) {
        runtime.lastError = `Booking reminder failed (${leadId}): ${err.message}`;
        appendReport(workspace, {
          kind: "booking_reminder",
          source: "booking_scheduler",
          ok: false,
          from: leadId,
          message: `Reminder ${minutesBefore}m`,
          error: err.message,
          bookingId: booking.id,
        });
      }
    }

    if (
      BOOKING_REBOOK_ENABLED &&
      !booking.noShowSentAt &&
      now.getTime() >
        start.getTime() + (BOOKING_NO_SHOW_GRACE_MINUTES + BOOKING_SLOT_MINUTES) * 60 * 1000
    ) {
      try {
        const message =
          "Looks like we missed the call. Want me to share the next available slots so we can rebook quickly?";
        await runtime.client.sendMessage(leadId, message);
        booking.status = "no_show";
        booking.noShowSentAt = new Date().toISOString();
        booking.updatedAt = booking.noShowSentAt;
        appendReport(workspace, {
          kind: "booking_no_show",
          source: "booking_scheduler",
          ok: true,
          from: leadId,
          message,
          bookingId: booking.id,
        });
        changed = true;
      } catch (err) {
        runtime.lastError = `No-show message failed (${leadId}): ${err.message}`;
      }
    }
  }
  return changed;
}

async function processBookingReminders() {
  if (!BOOKING_ENABLED) return;
  try {
    let changed = false;
    for (const workspace of store.workspaces) {
      const updated = await processWorkspaceBookingReminders(workspace);
      changed = changed || updated;
    }
    if (changed) saveStore();
  } catch (err) {
    console.error(`[ERROR] processBookingReminders: ${err.message}`);
  }
}

module.exports = {
  bookingApiReady,
  bookingIntentFromText,
  bookingLeadName,
  formatSlotForHumans,
  bookingReminderText,
  ensureGoogleCalendarClient,
  fetchBusyWindows,
  slotOverlapsBusy,
  findAvailableSlots,
  createCalendarBookingEvent,
  cancelCalendarBookingEvent,
  sendBookingIntentOptions,
  processWorkspaceBookingReminders,
  processBookingReminders,
};
