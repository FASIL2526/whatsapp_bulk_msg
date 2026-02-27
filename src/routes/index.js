/* ─── Route Aggregator ─────────────────────────────────────────────────────*/

const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");

const authRoutes = require("./auth.routes");
const workspaceRoutes = require("./workspace.routes");
const campaignRoutes = require("./campaign.routes");
const leadsRoutes = require("./leads.routes");
const bookingRoutes = require("./booking.routes");
const reportsRoutes = require("./reports.routes");
const mediaRoutes = require("./media.routes");
const schedulesRoutes = require("./schedules.routes");
const membersRoutes = require("./members.routes");
const debugRoutes = require("./debug.routes");
const automationRoutes = require("./automation.routes");
const agentRoutes = require("./agent.routes");
const billingRoutes = require("./billing.routes");
const backupRoutes = require("./backup.routes");
const toolsRoutes = require("./tools.routes");

function mountRoutes(app) {
  // ─── Public auth endpoints ───────────────────────────────────────────────
  app.use("/api/auth", authRoutes);

  // ─── Debug endpoints ─────────────────────────────────────────────────────
  app.use("/api/debug", debugRoutes);

  // ─── Public billing info (plan list) ─────────────────────────────────────
  app.use("/api", billingRoutes);

  // ─── All workspace-scoped endpoints require auth ─────────────────────────
  app.use("/api/workspaces", requireAuth, workspaceRoutes);
  app.use("/api/workspaces", requireAuth, campaignRoutes);
  app.use("/api/workspaces", requireAuth, leadsRoutes);
  app.use("/api/workspaces", requireAuth, bookingRoutes);
  app.use("/api/workspaces", requireAuth, reportsRoutes);
  app.use("/api/workspaces", requireAuth, mediaRoutes);
  app.use("/api/workspaces", requireAuth, schedulesRoutes);
  app.use("/api/workspaces", requireAuth, membersRoutes);
  app.use("/api/workspaces", requireAuth, automationRoutes);
  app.use("/api/workspaces", requireAuth, agentRoutes);
  app.use("/api/workspaces", requireAuth, billingRoutes);
  app.use("/api/workspaces", requireAuth, backupRoutes);
  app.use("/api/workspaces", requireAuth, toolsRoutes);
}

module.exports = { mountRoutes };
