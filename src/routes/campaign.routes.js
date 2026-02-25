/* ─── Campaign Routes ──────────────────────────────────────────────────────*/

const { Router } = require("express");
const { DEFAULT_CONFIG } = require("../config/default-config");
const { saveStore, getRuntime, workspaceRecipientsChatIds } = require("../models/store");
const { sanitizeText, sanitizeMultilineText } = require("../utils/workspace-config");
const { fetchWithRetry } = require("../utils/helpers");
const { requireWorkspace } = require("../middleware/auth");
const { statusHint } = require("../services/chrome.service");
const { postLeadSeekingStatus, generateAiAssistDraft } = require("../services/ai.service");
const {
  sendBulkMessage,
  createClientForWorkspace,
  stopWorkspaceClient,
  setupScheduler,
  setupStatusScheduler,
} = require("../services/whatsapp.service");

const router = Router();

router.get("/:workspaceId/status", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;

  const runtime = getRuntime(workspace.id);
  const connectElapsedSec =
    runtime.startRequestedAt && !runtime.ready
      ? Math.max(0, Math.floor((Date.now() - runtime.startRequestedAt) / 1000))
      : 0;
  const sendElapsedSec =
    runtime.sendInProgress && runtime.sendStartedAt
      ? Math.max(0, Math.floor((Date.now() - runtime.sendStartedAt) / 1000))
      : 0;
  res.json({
    status: runtime.status,
    ready: runtime.ready,
    authenticated: runtime.authenticated,
    waState: runtime.lastWaState || "",
    connectElapsedSec,
    qrDataUrl: runtime.qrDataUrl,
    hasScheduler: Boolean(runtime.scheduler),
    recipientsCount: workspaceRecipientsChatIds(workspace).length,
    sendInProgress: Boolean(runtime.sendInProgress),
    sendElapsedSec,
    lastError: runtime.lastError,
    hint: statusHint(runtime.lastError),
  });
});

router.post("/:workspaceId/start", async (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const runtime = getRuntime(workspace.id);
  if (runtime.client && runtime.ready) return res.json({ ok: true, status: runtime.status });
  if (runtime.status === "starting") return res.json({ ok: true, status: runtime.status });
  try {
    runtime.status = "starting";
    runtime.startRequestedAt = Date.now();
    runtime.lastError = "";
    await createClientForWorkspace(workspace);
    res.json({ ok: true, status: runtime.status });
  } catch (err) {
    runtime.status = "error";
    runtime.lastError = err.message;
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/:workspaceId/stop", async (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  try {
    await stopWorkspaceClient(workspace.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/:workspaceId/send-startup", async (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  try {
    const runtime = getRuntime(workspace.id);
    const message = workspace.config.STARTUP_MESSAGE || DEFAULT_CONFIG.STARTUP_MESSAGE;
    const results = await sendBulkMessage(workspace, runtime, message, { source: "startup" });
    res.json({ ok: true, message, results });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/:workspaceId/send-custom", async (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  try {
    const runtime = getRuntime(workspace.id);
    let messages = [];
    if (Array.isArray(req.body?.messages)) {
      messages = req.body.messages.map((m) => sanitizeMultilineText(m, "")).filter(Boolean);
    } else {
      const single = sanitizeMultilineText(req.body?.message, "");
      if (single) messages.push(single);
    }

    const mediaId = sanitizeText(req.body?.mediaId, "");
    const sendAtRaw = sanitizeText(req.body?.sendAt, "");
    const sendAt = sendAtRaw ? new Date(sendAtRaw) : null;

    if (messages.length === 0 && !mediaId) {
      return res.status(400).json({ ok: false, error: "At least one message or mediaId is required." });
    }

    // Future sendAt → create scheduled entry
    if (sendAt && !Number.isNaN(sendAt.getTime()) && sendAt.getTime() > Date.now()) {
      workspace.scheduledMessages = Array.isArray(workspace.scheduledMessages)
        ? workspace.scheduledMessages
        : [];
      const id = `sm_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`;
      const rec = {
        id,
        message: messages.join("\n"),
        sendAt: sendAt.toISOString(),
        status: "pending",
        mediaId: mediaId || "",
        createdAt: new Date().toISOString(),
        sentAt: "",
      };
      workspace.scheduledMessages.push(rec);
      saveStore();
      return res.json({ ok: true, scheduled: rec });
    }

    const results = await sendBulkMessage(
      workspace,
      runtime,
      messages.length > 0 ? messages : [""],
      {
        source: "custom",
        mode: req.body?.mode,
        delayMs: req.body?.delayMs,
        randomMinMs: req.body?.randomMinMs,
        randomMaxMs: req.body?.randomMaxMs,
        templateMode: req.body?.templateMode,
        templateLines: req.body?.templateLines,
        mediaId: mediaId || undefined,
      }
    );
    res.json({ ok: true, messages, mediaId: mediaId || null, results });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/:workspaceId/status-post-now", async (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  try {
    const runtime = getRuntime(workspace.id);
    const posted = await postLeadSeekingStatus(workspace, runtime, "status_manual");
    res.json({ ok: true, posted });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/:workspaceId/validate-ai-key", async (req, res) => {
  try {
    const { apiKey, model: modelName, provider } = req.body;
    if (!apiKey) return res.status(400).json({ ok: false, error: "API Key is required" });

    const selectedModel =
      modelName || (provider === "openrouter" ? "google/gemini-2.0-flash-001" : "gemini-1.5-flash");
    const activeProvider = provider || "google";
    console.log(`[SYSTEM] Validating API Key for provider: ${activeProvider}, model: ${selectedModel}`);

    if (activeProvider === "google") {
      const { GoogleGenerativeAI } = require("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: selectedModel });
      await model.generateContent("hi");
    } else if (activeProvider === "openrouter") {
      const response = await fetchWithRetry("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 5,
        }),
      }, { retries: 1, timeoutMs: 15000, label: "validate-key" });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || "OpenRouter Error");
    }
    res.json({ ok: true, message: "API Key is valid" });
  } catch (err) {
    console.error("API Validation Error:", err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/:workspaceId/ai-data-assist", async (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  try {
    const { sanitizeText: st } = require("../utils/workspace-config");
    const payload = {
      businessName: st(req.body?.businessName, ""),
      offer: st(req.body?.offer, ""),
      targetAudience: st(req.body?.targetAudience, ""),
      goal: st(req.body?.goal, ""),
      tone: st(req.body?.tone, "balanced"),
      provider: st(req.body?.provider, workspace.config.AI_PROVIDER || "google"),
      model: st(req.body?.model, workspace.config.AI_MODEL || DEFAULT_CONFIG.AI_MODEL),
      apiKey: st(req.body?.apiKey, workspace.config.AI_API_KEY || ""),
    };
    const generated = await generateAiAssistDraft(payload, workspace.config || DEFAULT_CONFIG);
    res.json({ ok: true, ...generated });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
