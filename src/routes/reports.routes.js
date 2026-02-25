/* ─── Reports Routes ───────────────────────────────────────────────────────*/

const { Router } = require("express");
const { requireWorkspace } = require("../middleware/auth");
const { toCsv } = require("../utils/helpers");
const {
  getReportWindow,
  getWorkspaceReports,
  reportSummary,
} = require("../services/report.service");

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

module.exports = router;
