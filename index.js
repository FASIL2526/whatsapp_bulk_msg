/* ═══════════════════════════════════════════════════════════════════════════
   WhatsApp Automation — Slim Entry Point
   ═══════════════════════════════════════════════════════════════════════════ */

require("dotenv").config();

const path = require("path");
const express = require("express");
const { configureRuntimeEnv } = require("./src/config/runtime-env");
const { PORT, HOST } = require("./src/config/env");
const { ensureStore, startAutoBackup } = require("./src/models/store");
const { mountRoutes } = require("./src/routes");
const { processAutoFollowUps } = require("./src/services/lead.service");
const { processBookingReminders } = require("./src/services/booking.service");
const { processScheduledMessages } = require("./src/services/whatsapp.service");
const { processNurtureDrip } = require("./src/services/nurture-drip.service");
const { processReengagement } = require("./src/services/reengage.service");
const { processEscalations } = require("./src/services/escalation.service");
const { processLeadRouting } = require("./src/services/lead-routing.service");
const { processAbTesting } = require("./src/services/ab-testing.service");
const { processDailyDigest } = require("./src/services/daily-digest.service");
const { processConversationCleanup } = require("./src/services/cleanup.service");
const { processAutoTagging } = require("./src/services/tagging.service");
const { processOutboundProspecting } = require("./src/services/outbound-prospecting.service");
const { processGoalPlanner } = require("./src/services/goal-planner.service");
const { processPromptTuning } = require("./src/services/prompt-tuning.service");
const { processSelfHealing } = require("./src/services/self-healing.service");
const { processAlertQueue, processAutoReport } = require("./src/services/whatsapp-alerts.service");

// ─── Runtime environment (Chrome paths, etc.) ──────────────────────────────
configureRuntimeEnv();

// ─── Express app ───────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ─── Mount all API routes ──────────────────────────────────────────────────
mountRoutes(app);

// ─── Boot ──────────────────────────────────────────────────────────────────
function startHttpServer() {
  try {
    ensureStore();
    startAutoBackup();
  } catch (err) {
    console.error(`[FATAL] Failed to initialize data store: ${err.message}`);
    process.exit(1);
  }

  // Background sweep every 60 s
  setInterval(() => {
    processAutoFollowUps();
    processBookingReminders();
    processScheduledMessages();
    processNurtureDrip();
    processReengagement();
    processEscalations();
    processLeadRouting();
    processAbTesting();
    processConversationCleanup();
    processAutoTagging();
    processOutboundProspecting();
    processGoalPlanner();
    processAlertQueue();
  }, 60_000);

  // Daily sweeps run every 5 min (each has internal once-per-day guard)
  setInterval(() => {
    processDailyDigest();
    processPromptTuning();
    processSelfHealing();
    processAutoReport();
  }, 5 * 60_000);

  const allowPortFallback =
    process.env.NODE_ENV !== "production" && process.env.AUTO_PORT_FALLBACK !== "false";
  const maxAttempts = allowPortFallback ? 10 : 0;

  const listenOn = (port, remaining) => {
    const server = app.listen(port, HOST, () => {
      console.log(`Web app running at http://${HOST}:${port}`);
      if (port !== PORT) console.log(`[INFO] Preferred port ${PORT} was busy. Using ${port}.`);
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && remaining > 0) {
        console.error(`[WARN] Port ${port} in use. Trying ${port + 1}…`);
        listenOn(port + 1, remaining - 1);
        return;
      }
      if (err.code === "EADDRINUSE")
        console.error(`[FATAL] ${HOST}:${port} in use. Set PORT to a free port.`);
      else if (err.code === "EACCES")
        console.error(`[FATAL] Permission denied for ${HOST}:${port}. Use a non-privileged port.`);
      else console.error(`[FATAL] Server failed: ${err.message}`);
      process.exit(1);
    });
  };

  listenOn(PORT, maxAttempts);
}

startHttpServer();

// ─── Global error guards ───────────────────────────────────────────────────
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err));
