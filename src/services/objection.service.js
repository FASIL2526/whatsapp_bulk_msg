/* ─── Objection Recovery Service ────────────────────────────────────────────
 *  Detects objections in lead messages and autonomously counters
 *  with pre-trained rebuttals from the playbook.
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore, getRuntime, appendReport } = require("../models/store");
const { sanitizeText } = require("../utils/workspace-config");

const DEFAULT_REBUTTALS = {
  price: "I totally understand budget concerns. What if we looked at the ROI? Most clients see returns within 2 weeks that far exceed the cost. Would a quick ROI breakdown help?",
  expensive: "I hear you. Let me share what similar businesses saved after switching — often the tool pays for itself in the first month.",
  "not now": "No rush at all. Quick question though — what would need to change for the timing to be right? I can set a reminder.",
  "too busy": "Completely understand. The good news is setup takes under 10 minutes. Want me to send a quick-start guide you can review when you have a moment?",
  later: "Sure thing. When would be a good time to circle back? I'll make a note so you don't have to remember.",
  "not interested": "Appreciate your honesty. Just curious — was there something specific that didn't fit, or is it a timing thing?",
  "already have": "Got it — what are you using currently? Sometimes we find complementary value even alongside existing tools.",
  trust: "That's fair. Here's a quick case study from a client in a similar situation — they started with a small pilot. Would that work?",
  competitor: "Good to know you're evaluating options. What matters most to you? We can do a quick side-by-side comparison.",
  "no budget": "Understood. We have flexible plans starting quite low — and we could also explore a pilot to prove value before committing.",
};

function parsePlaybook(raw) {
  const rebuttals = { ...DEFAULT_REBUTTALS };
  if (!raw) return rebuttals;
  const lines = String(raw).split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) rebuttals[key] = value;
  }
  return rebuttals;
}

function detectObjection(text) {
  const lower = (text || "").toLowerCase();
  const keywords = [
    "too expensive", "expensive", "price", "cost too much",
    "not now", "maybe later", "later", "too busy", "busy",
    "not interested", "no thanks", "pass",
    "already have", "already using", "have a solution",
    "don't trust", "trust", "how do I know",
    "competitor", "other tool", "alternative",
    "no budget", "can't afford",
  ];
  for (const kw of keywords) {
    if (lower.includes(kw)) {
      // Map to rebuttal key
      if (kw.includes("expensive") || kw.includes("price") || kw.includes("cost")) return "price";
      if (kw.includes("not now") || kw.includes("later")) return "later";
      if (kw.includes("busy")) return "too busy";
      if (kw.includes("not interested") || kw.includes("no thanks") || kw.includes("pass")) return "not interested";
      if (kw.includes("already")) return "already have";
      if (kw.includes("trust") || kw.includes("how do I know")) return "trust";
      if (kw.includes("competitor") || kw.includes("other tool") || kw.includes("alternative")) return "competitor";
      if (kw.includes("budget") || kw.includes("afford")) return "no budget";
      return kw;
    }
  }
  return null;
}

/**
 * This is called from the incoming message handler to intercept objections.
 * Returns a rebuttal string or null if no objection detected.
 */
function getObjectionRebuttal(workspace, messageText) {
  if (workspace.config?.AUTO_OBJECTION_ENABLED !== "true") return null;
  const objectionKey = detectObjection(messageText);
  if (!objectionKey) return null;

  const playbook = parsePlaybook(workspace.config?.AI_OBJECTION_PLAYBOOK);
  return playbook[objectionKey] || null;
}

module.exports = { getObjectionRebuttal, detectObjection, parsePlaybook, DEFAULT_REBUTTALS };
