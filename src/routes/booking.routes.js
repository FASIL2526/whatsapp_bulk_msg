/* ─── Booking Routes ───────────────────────────────────────────────────────*/

const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const { BOOKING_TIMEZONE, BOOKING_SLOT_MINUTES, BOOKING_REMINDER_MINUTES } = require("../config/env");
const { sanitizeText } = require("../utils/workspace-config");
const {
  getWorkspace,
  hasWorkspaceRole,
  saveStore,
  getRuntime,
  ensureWorkspaceBookings,
  bookingById,
  bookingTimezone,
  initBookingRecord,
} = require("../models/store");
const { updateLeadStatus } = require("../services/lead.service");
const {
  bookingIntentFromText,
  bookingLeadName,
  formatSlotForHumans,
  findAvailableSlots,
  createCalendarBookingEvent,
  cancelCalendarBookingEvent,
  processWorkspaceBookingReminders,
} = require("../services/booking.service");

const router = Router();

router.get("/:workspaceId/bookings", requireAuth, async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found" });
    if (!hasWorkspaceRole(workspace, req.user.id, "member"))
      return res.status(403).json({ ok: false, error: "Forbidden" });
    ensureWorkspaceBookings(workspace);
    res.json({ ok: true, bookings: workspace.bookings });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/:workspaceId/booking/intent", requireAuth, async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found" });
    if (!hasWorkspaceRole(workspace, req.user.id, "admin"))
      return res.status(403).json({ ok: false, error: "Forbidden" });
    const leadId = sanitizeText(req.body?.leadId, "");
    const message = sanitizeText(req.body?.message, "");
    const timezone = bookingTimezone(req.body?.timezone || BOOKING_TIMEZONE);
    const intent = bookingIntentFromText(message);
    if (!intent) return res.json({ ok: true, intent: false, slots: [] });
    const slots = await findAvailableSlots({ timezone, limit: 6 });
    const runtime = getRuntime(workspace.id);
    if (leadId && slots.length > 0) {
      runtime.bookingOfferByLeadId.set(leadId, {
        slots,
        createdAt: new Date().toISOString(),
      });
    }
    res.json({ ok: true, intent: true, timezone, slots });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get("/:workspaceId/booking/slots", requireAuth, async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found" });
    if (!hasWorkspaceRole(workspace, req.user.id, "admin"))
      return res.status(403).json({ ok: false, error: "Forbidden" });
    const timezone = bookingTimezone(req.query?.tz || BOOKING_TIMEZONE);
    const limit = Math.min(
      20,
      Math.max(1, Number.parseInt(String(req.query?.limit || "8"), 10) || 8)
    );
    const slots = await findAvailableSlots({ timezone, limit });
    res.json({ ok: true, timezone, slots });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/:workspaceId/booking/confirm", requireAuth, async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found" });
    if (!hasWorkspaceRole(workspace, req.user.id, "admin"))
      return res.status(403).json({ ok: false, error: "Forbidden" });
    ensureWorkspaceBookings(workspace);
    const leadId = sanitizeText(req.body?.leadId, "");
    if (!leadId) return res.status(400).json({ ok: false, error: "leadId is required" });
    const leadName = sanitizeText(
      req.body?.leadName,
      bookingLeadName(leadId, workspace, "Lead")
    );
    const timezone = bookingTimezone(req.body?.timezone || BOOKING_TIMEZONE);
    const startAt = new Date(req.body?.startAt || "");
    if (Number.isNaN(startAt.getTime()))
      return res.status(400).json({ ok: false, error: "startAt must be a valid ISO datetime" });
    const durationMinutes = Math.max(
      15,
      Number.parseInt(String(req.body?.durationMinutes || BOOKING_SLOT_MINUTES), 10) ||
        BOOKING_SLOT_MINUTES
    );
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
    const notes = sanitizeText(req.body?.notes, "");

    const event = await createCalendarBookingEvent({
      leadName,
      leadId,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      notes,
      timezone,
    });
    const booking = initBookingRecord({
      leadId,
      leadName,
      timezone,
      status: "confirmed",
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      calendarEventId: sanitizeText(event.id, ""),
      meetingLink: sanitizeText(event.hangoutLink, ""),
      notes,
      reminderMinutes: sanitizeText(
        req.body?.reminderMinutes,
        BOOKING_REMINDER_MINUTES.join(",")
      ),
    });
    workspace.bookings.push(booking);
    updateLeadStatus(workspace, { from: leadId, stage: "booking", reason: "Booking confirmed" });
    saveStore();

    const runtime = getRuntime(workspace.id);
    if (runtime.client && runtime.ready && req.body?.notifyLead !== false) {
      const when = formatSlotForHumans(booking.startAt, booking.timezone);
      const meetLine = booking.meetingLink ? `\nMeeting link: ${booking.meetingLink}` : "";
      await runtime.client.sendMessage(
        leadId,
        `Your call is confirmed for ${when}.${meetLine}`.trim()
      );
    }
    res.json({ ok: true, booking });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/:workspaceId/booking/cancel", requireAuth, async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found" });
    if (!hasWorkspaceRole(workspace, req.user.id, "admin"))
      return res.status(403).json({ ok: false, error: "Forbidden" });
    ensureWorkspaceBookings(workspace);
    const bookingId = sanitizeText(req.body?.bookingId, "");
    if (!bookingId) return res.status(400).json({ ok: false, error: "bookingId is required" });
    const booking = bookingById(workspace, bookingId);
    if (!booking) return res.status(404).json({ ok: false, error: "Booking not found" });
    if (booking.calendarEventId) await cancelCalendarBookingEvent(booking.calendarEventId);
    booking.status = "cancelled";
    booking.updatedAt = new Date().toISOString();
    saveStore();

    const runtime = getRuntime(workspace.id);
    if (
      runtime.client &&
      runtime.ready &&
      booking.leadId &&
      req.body?.notifyLead !== false
    ) {
      await runtime.client.sendMessage(
        booking.leadId,
        "Your call booking has been cancelled. Reply with 'book call' to get new slots."
      );
    }
    res.json({ ok: true, booking });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/:workspaceId/booking/reminder-sweep", requireAuth, async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found" });
    if (!hasWorkspaceRole(workspace, req.user.id, "admin"))
      return res.status(403).json({ ok: false, error: "Forbidden" });
    const updated = await processWorkspaceBookingReminders(workspace);
    if (updated) saveStore();
    res.json({ ok: true, updated });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
