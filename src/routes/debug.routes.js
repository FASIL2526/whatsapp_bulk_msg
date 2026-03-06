/* ─── Debug Routes ─────────────────────────────────────────────────────────*/

const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const { chromeDebugInfo } = require("../services/chrome.service");

const router = Router();

router.get("/chrome", requireAuth, (_req, res) => {
  res.json(chromeDebugInfo());
});

module.exports = router;
