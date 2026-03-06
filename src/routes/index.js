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
const knowledgeBaseRoutes = require("./knowledge-base.routes");

function mountRoutes(app) {
  // ─── Security headers ────────────────────────────────────────────────────
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.removeHeader("X-Powered-By");
    next();
  });

  // ─── Simple rate limiter for auth routes (5 req / 15 sec per IP) ─────────
  const authRateMap = new Map();
  const AUTH_RATE_WINDOW = 15_000;
  const AUTH_RATE_MAX = 5;
  setInterval(() => authRateMap.clear(), AUTH_RATE_WINDOW);

  const authRateLimit = (req, res, next) => {
    const key = req.ip || req.connection?.remoteAddress || "unknown";
    const count = (authRateMap.get(key) || 0) + 1;
    authRateMap.set(key, count);
    if (count > AUTH_RATE_MAX) {
      return res.status(429).json({ ok: false, error: "Too many requests. Try again later." });
    }
    next();
  };

  // ─── Public auth endpoints ───────────────────────────────────────────────
  app.use("/api/auth", authRateLimit, authRoutes);

  // ─── Debug endpoints (auth required) ──────────────────────────────────────
  app.use("/api/debug", requireAuth, debugRoutes);

  // ─── Public billing info (plan list only — the router's GET /plans is public) ──
  // Only mount the /plans route publicly; all admin routes need auth + workspace
  app.get("/api/plans", (_req, res) => {
    const { getAllPlans } = require("../services/plan.service");
    res.json({ ok: true, plans: getAllPlans() });
  });

  // ─── Health check endpoint ───────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

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
  app.use("/api/workspaces", requireAuth, knowledgeBaseRoutes);

  // ─── Global error handler (catches unhandled async route errors) ─────────
  app.use((err, _req, res, _next) => {
    console.error("[EXPRESS ERROR]", err.stack || err.message || err);
    if (res.headersSent) return;
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      ok: false,
      error: process.env.NODE_ENV === "production" ? "Internal server error" : (err.message || "Unknown error"),
    });
  });
}

module.exports = { mountRoutes };
