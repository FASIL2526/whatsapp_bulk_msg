/* ─── A/B Testing Service ──────────────────────────────────────────────────
 *  Autonomously tests message variants, tracks reply rates,
 *  and shifts toward the winning approach.
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore, getRuntime, appendReport } = require("../models/store");
const { sanitizeText } = require("../utils/workspace-config");

/**
 * AB test record shape (stored in workspace.abTests[]):
 * {
 *   id, name, status: "running"|"completed"|"paused",
 *   variants: [{ id, message, sent: 0, replied: 0 }],
 *   winnerId: "",
 *   createdAt, updatedAt
 * }
 */

function getActiveTest(workspace) {
  if (!Array.isArray(workspace.abTests)) workspace.abTests = [];
  return workspace.abTests.find((t) => t.status === "running") || null;
}

function pickVariant(test) {
  if (!test || !Array.isArray(test.variants) || test.variants.length === 0) return null;

  const totalSent = test.variants.reduce((s, v) => s + (v.sent || 0), 0);
  // First 20 sends: round-robin for fair distribution
  if (totalSent < 20) {
    const minSent = Math.min(...test.variants.map((v) => v.sent || 0));
    return test.variants.find((v) => (v.sent || 0) === minSent) || test.variants[0];
  }

  // After 20+: use Thompson Sampling (epsilon-greedy simplified)
  // 80% exploit best variant, 20% explore
  if (Math.random() < 0.2) {
    return test.variants[Math.floor(Math.random() * test.variants.length)];
  }

  // Pick variant with highest reply rate
  let best = test.variants[0];
  let bestRate = 0;
  for (const v of test.variants) {
    const rate = v.sent > 0 ? (v.replied || 0) / v.sent : 0;
    if (rate > bestRate) {
      bestRate = rate;
      best = v;
    }
  }
  return best;
}

function recordSent(workspace, testId, variantId) {
  const test = (workspace.abTests || []).find((t) => t.id === testId);
  if (!test) return;
  const variant = test.variants.find((v) => v.id === variantId);
  if (variant) variant.sent = (variant.sent || 0) + 1;
  test.updatedAt = new Date().toISOString();
}

function recordReply(workspace, leadId) {
  if (!Array.isArray(workspace.abTests)) return;
  // Find which variant was last sent to this lead
  for (const test of workspace.abTests) {
    if (test.status !== "running") continue;
    const variantId = test.lastSentVariant?.[leadId];
    if (!variantId) continue;
    const variant = test.variants.find((v) => v.id === variantId);
    if (variant) {
      variant.replied = (variant.replied || 0) + 1;
      test.updatedAt = new Date().toISOString();
    }
  }
}

function autoCompleteTest(workspace) {
  if (!Array.isArray(workspace.abTests)) return false;
  let changed = false;
  for (const test of workspace.abTests) {
    if (test.status !== "running") continue;
    const totalSent = test.variants.reduce((s, v) => s + (v.sent || 0), 0);
    const minPerVariant = parseInt(workspace.config?.AB_TEST_MIN_SENDS || "30", 10) || 30;

    // Complete when all variants have enough sends
    const allHaveEnough = test.variants.every((v) => (v.sent || 0) >= minPerVariant);
    if (!allHaveEnough) continue;

    // Pick winner
    let bestVariant = test.variants[0];
    let bestRate = 0;
    for (const v of test.variants) {
      const rate = v.sent > 0 ? (v.replied || 0) / v.sent : 0;
      if (rate > bestRate) {
        bestRate = rate;
        bestVariant = v;
      }
    }
    test.winnerId = bestVariant.id;
    test.status = "completed";
    test.updatedAt = new Date().toISOString();

    appendReport(workspace, {
      kind: "ab_test_completed",
      source: "ab_test_autopilot",
      ok: true,
      message: `Test "${test.name}" completed. Winner: variant ${bestVariant.id} (${Math.round(bestRate * 100)}% reply rate)`,
    });
    changed = true;
  }
  return changed;
}

function createAbTest(workspace, name, messages) {
  if (!Array.isArray(workspace.abTests)) workspace.abTests = [];

  // Pause any running tests
  for (const t of workspace.abTests) {
    if (t.status === "running") t.status = "paused";
  }

  const test = {
    id: `ab_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`,
    name: sanitizeText(name, "A/B Test"),
    status: "running",
    variants: messages.map((msg, i) => ({
      id: `v${i + 1}`,
      message: msg,
      sent: 0,
      replied: 0,
    })),
    lastSentVariant: {}, // { leadId: variantId }
    winnerId: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  workspace.abTests.push(test);
  saveStore();
  return test;
}

async function processAbTesting() {
  try {
    let changed = false;
    for (const ws of store.workspaces) {
      if (ws.config?.AB_TEST_ENABLED !== "true") continue;
      const updated = autoCompleteTest(ws);
      changed = changed || updated;
    }
    if (changed) saveStore();
  } catch (err) {
    console.error(`[ERROR] processAbTesting: ${err.message}`);
  }
}

module.exports = {
  processAbTesting,
  getActiveTest,
  pickVariant,
  recordSent,
  recordReply,
  autoCompleteTest,
  createAbTest,
};
