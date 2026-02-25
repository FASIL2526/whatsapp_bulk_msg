/* ─── Reports Routes ───────────────────────────────────────────────────────*/

const { Router } = require("express");
const { requireWorkspace } = require("../middleware/auth");
const { toCsv } = require("../utils/helpers");
const {
  getReportWindow,
  getWorkspaceReports,
  reportSummary,
} = require("../services/report.service");
const {
  computeAttribution,
  computeScoringFeedback,
  getWeeklyRevenue,
  getMonthlyRevenue,
} = require("../services/revenue-attribution.service");

const router = Router();

router.get("/:workspaceId/reports/summary", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const window = getReportWindow(req.query || {});
  const reports = getWorkspaceReports(workspace, window);
  res.json({
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    summary: reportSummary(reports),
  });
});

router.get("/:workspaceId/reports/logs", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const window = getReportWindow(req.query || {});
  const limit = Math.min(
    1000,
    Math.max(1, Number.parseInt(String(req.query?.limit || "200"), 10) || 200)
  );
  const reports = getWorkspaceReports(workspace, window)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
  res.json({ from: window.from.toISOString(), to: window.to.toISOString(), logs: reports });
});

router.get("/:workspaceId/reports/csv", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const window = getReportWindow(req.query || {});
  const reports = getWorkspaceReports(workspace, window).sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );
  const csv = toCsv([
    [
      "at",
      "kind",
      "source",
      "ok",
      "mode",
      "templateMode",
      "chatId",
      "from",
      "incoming",
      "message",
      "error",
    ],
    ...reports.map((e) => [
      e.at,
      e.kind,
      e.source,
      String(e.ok),
      e.mode || "",
      e.templateMode || "",
      e.chatId || "",
      e.from || "",
      e.incoming || "",
      e.message || "",
      e.error || "",
    ]),
  ]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${workspace.id}-reports.csv"`
  );
  res.send(csv);
});

// ═══════════════════════════════════════════════════════════════════════════
// FULL ANALYTICS — aggregates message stats, revenue, funnel, scoring, logs
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:workspaceId/reports/analytics", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;

  const window = getReportWindow(req.query || {});
  const reports = getWorkspaceReports(workspace, window);
  const summary = reportSummary(reports);

  // Revenue & attribution
  const attribution = computeAttribution(workspace);
  const feedback = computeScoringFeedback(workspace);
  const weeklyRev = getWeeklyRevenue(workspace);
  const monthlyRev = getMonthlyRevenue(workspace);

  // Lead pipeline stats
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const pipeline = {
    total: leads.length,
    new: leads.filter(l => l.stage === "new").length,
    qualified: leads.filter(l => l.stage === "qualified").length,
    proposal: leads.filter(l => l.stage === "proposal").length,
    booking: leads.filter(l => l.stage === "booking").length,
    closedWon: leads.filter(l => l.stage === "closed_won").length,
    closedLost: leads.filter(l => l.stage === "closed_lost").length,
    hot: leads.filter(l => l.status === "hot").length,
    warm: leads.filter(l => l.status === "warm").length,
    cold: leads.filter(l => l.status === "cold").length,
  };

  // Recent activity (last 20)
  const recentLogs = reports
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 20)
    .map(r => ({
      at: r.at,
      kind: r.kind,
      source: r.source || "unknown",
      ok: r.ok,
      chatId: r.chatId || "",
      message: (r.message || "").slice(0, 80),
    }));

  // Message volume by day (for sparkline)
  const dailyVolume = {};
  for (const r of reports) {
    const day = new Date(r.at).toISOString().slice(0, 10);
    if (!dailyVolume[day]) dailyVolume[day] = { sent: 0, received: 0, failed: 0 };
    if (r.kind === "outgoing" && r.ok) dailyVolume[day].sent++;
    else if (r.kind === "outgoing" && !r.ok) dailyVolume[day].failed++;
    else if (r.kind === "incoming" || r.kind === "auto_reply") dailyVolume[day].received++;
  }

  res.json({
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    summary,
    attribution,
    feedback,
    weeklyRevenue: weeklyRev,
    monthlyRevenue: monthlyRev,
    pipeline,
    recentLogs,
    dailyVolume,
  });
});

module.exports = router;
