/* ─── Debug Routes ─────────────────────────────────────────────────────────*/

const { Router } = require("express");
const { chromeDebugInfo } = require("../services/chrome.service");

const router = Router();

router.get("/chrome", (_req, res) => {
  res.json(chromeDebugInfo());
});

module.exports = router;
