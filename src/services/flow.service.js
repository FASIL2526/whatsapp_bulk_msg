/* ─── Chatbot Flow Builder Service ──────────────────────────────────────────
 *  Keyword-based conversation branching — "if user says X, reply Y, ask Z".
 *  Flows are stored per-workspace and evaluated before the AI handler.
 * ─────────────────────────────────────────────────────────────────────────── */

const { saveStore } = require("../models/store");
const { sanitizeText } = require("../utils/workspace-config");

function ensureFlows(workspace) {
  if (!Array.isArray(workspace.chatFlows)) workspace.chatFlows = [];
}

/** Create a new chat flow */
function createFlow(workspace, { name, trigger, triggerMode, steps, enabled }) {
  ensureFlows(workspace);
  const flow = {
    id: `flow_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`,
    name: sanitizeText(name, "Untitled Flow"),
    trigger: sanitizeText(trigger, ""),
    triggerMode: triggerMode === "contains" ? "contains" : triggerMode === "regex" ? "regex" : "exact",
    steps: Array.isArray(steps) ? steps.map(normalizeStep) : [],
    enabled: enabled !== false,
    hitCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  workspace.chatFlows.push(flow);
  saveStore();
  return flow;
}

/** Normalize a flow step */
function normalizeStep(step) {
  return {
    id: step.id || `step_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`,
    type: step.type === "question" ? "question" : step.type === "condition" ? "condition" : "reply",
    message: sanitizeText(step.message, ""),
    options: Array.isArray(step.options) ? step.options.map(o => ({
      label: sanitizeText(o.label, ""),
      value: sanitizeText(o.value, ""),
      nextStepId: sanitizeText(o.nextStepId, ""),
    })) : [],
    nextStepId: sanitizeText(step.nextStepId, ""),
    delay: Math.max(0, Number(step.delay) || 0),
    setTag: sanitizeText(step.setTag, ""),
    setStage: sanitizeText(step.setStage, ""),
  };
}

/** Update a flow */
function updateFlow(workspace, flowId, updates) {
  ensureFlows(workspace);
  const flow = workspace.chatFlows.find(f => f.id === flowId);
  if (!flow) throw new Error("Flow not found.");
  if (updates.name !== undefined) flow.name = sanitizeText(updates.name, flow.name);
  if (updates.trigger !== undefined) flow.trigger = sanitizeText(updates.trigger, flow.trigger);
  if (updates.triggerMode !== undefined) flow.triggerMode = updates.triggerMode === "contains" ? "contains" : updates.triggerMode === "regex" ? "regex" : "exact";
  if (updates.steps !== undefined) flow.steps = Array.isArray(updates.steps) ? updates.steps.map(normalizeStep) : flow.steps;
  if (updates.enabled !== undefined) flow.enabled = !!updates.enabled;
  flow.updatedAt = new Date().toISOString();
  saveStore();
  return flow;
}

/** Delete a flow */
function deleteFlow(workspace, flowId) {
  ensureFlows(workspace);
  const idx = workspace.chatFlows.findIndex(f => f.id === flowId);
  if (idx === -1) return false;
  workspace.chatFlows.splice(idx, 1);
  saveStore();
  return true;
}

/** List all flows */
function listFlows(workspace) {
  ensureFlows(workspace);
  return workspace.chatFlows;
}

/** Get a specific flow */
function getFlow(workspace, flowId) {
  ensureFlows(workspace);
  return workspace.chatFlows.find(f => f.id === flowId) || null;
}

/**
 * Match an incoming message against all enabled flows.
 * Returns the first matching flow or null.
 */
function matchFlow(workspace, messageText) {
  ensureFlows(workspace);
  const text = String(messageText || "").trim().toLowerCase();
  if (!text) return null;

  for (const flow of workspace.chatFlows) {
    if (!flow.enabled || !flow.trigger) continue;

    const trigger = flow.trigger.toLowerCase();
    let matched = false;

    if (flow.triggerMode === "exact") {
      matched = text === trigger;
    } else if (flow.triggerMode === "contains") {
      matched = text.includes(trigger);
    } else if (flow.triggerMode === "regex") {
      try {
        matched = new RegExp(flow.trigger, "i").test(messageText);
      } catch { /* invalid regex */ }
    }

    if (matched) {
      flow.hitCount = (flow.hitCount || 0) + 1;
      flow.lastHitAt = new Date().toISOString();
      saveStore();
      return flow;
    }
  }
  return null;
}

/** Get the first step of a flow */
function getFirstStep(flow) {
  return (flow.steps && flow.steps.length > 0) ? flow.steps[0] : null;
}

/** Get a step by ID */
function getStepById(flow, stepId) {
  return (flow.steps || []).find(s => s.id === stepId) || null;
}

module.exports = {
  ensureFlows,
  createFlow,
  updateFlow,
  deleteFlow,
  listFlows,
  getFlow,
  matchFlow,
  getFirstStep,
  getStepById,
};
