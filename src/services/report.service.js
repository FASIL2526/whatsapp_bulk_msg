/* ─── Report Service ───────────────────────────────────────────────────────
 *  Report windowing, summary computation, and CSV helpers.
 * ─────────────────────────────────────────────────────────────────────────── */

const { sanitizeChoice } = require("../utils/workspace-config");
const { parseIsoInput } = require("../utils/helpers");

function getReportWindow(query) {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const from = parseIsoInput(query.from, defaultFrom);
  const to = parseIsoInput(query.to, now);
  return {
    from: from.getTime() <= to.getTime() ? from : to,
    to: to.getTime() >= from.getTime() ? to : from,
  };
}

function getWorkspaceReports(workspace, window) {
  const reports = Array.isArray(workspace.reports) ? workspace.reports : [];
  return reports.filter((entry) => {
    const at = new Date(entry.at);
    if (Number.isNaN(at.getTime())) return false;
    return at >= window.from && at <= window.to;
  });
}

function reportSummary(reports) {
  const summary = {
    total: reports.length,
    sentOk: 0,
    sentFailed: 0,
    autoReplies: 0,
    followUps: 0,
    autoStatuses: 0,
    bySource: {},
  };

  for (const entry of reports) {
    if (entry.kind === "outgoing") {
      if (entry.ok) summary.sentOk += 1;
      else summary.sentFailed += 1;
    }
    if (entry.kind === "auto_reply") summary.autoReplies += 1;
    if (entry.kind === "auto_follow_up") summary.followUps += 1;
    if (entry.kind === "auto_status") summary.autoStatuses += 1;
    const source = entry.source || "unknown";
    summary.bySource[source] = (summary.bySource[source] || 0) + 1;
  }
  return summary;
}

module.exports = {
  getReportWindow,
  getWorkspaceReports,
  reportSummary,
};
