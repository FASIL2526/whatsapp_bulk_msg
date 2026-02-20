require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cron = require("node-cron");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "workspaces.json");
const MAX_REPORT_ENTRIES = 5000;

const DEFAULT_CONFIG = {
  HEADLESS: "true",
  RECIPIENTS: "",
  STARTUP_MESSAGE: "Automation is live.",
  BULK_SEND_MODE: "instant",
  BULK_DELAY_MS: "1500",
  BULK_RANDOM_MIN_MS: "700",
  BULK_RANDOM_MAX_MS: "2500",
  BULK_TEMPLATE_MODE: "single",
  BULK_TEMPLATE_LINES: "",
  AUTO_REPLY_ENABLED: "true",
  AUTO_REPLY_MODE: "exact",
  AUTO_REPLY_TRIGGER: "hi",
  AUTO_REPLY_TEXT: "Hello! This is an auto-reply.",
  AUTO_REPLY_RULES: "",
  SCHEDULE_ENABLED: "false",
  SCHEDULE_CRON: "0 9 * * *",
  SCHEDULE_MESSAGE: "Daily reminder",
};

const store = {
  workspaces: [],
};

const runtimeByWorkspaceId = new Map();

function normalizeRecipients(raw) {
  return String(raw)
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/[^0-9]/g, ""))
    .filter(Boolean);
}

function sanitizeText(value, fallback) {
  return String(value ?? fallback)
    .replace(/\r?\n/g, " ")
    .trim();
}

function sanitizeMultilineText(value, fallback) {
  return String(value ?? fallback).replace(/\r/g, "").trim();
}

function sanitizeChoice(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function sanitizeIntegerString(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) {
    return String(fallback);
  }
  return String(Math.min(max, Math.max(min, parsed)));
}

function sanitizeWorkspaceConfig(input) {
  const clean = {
    HEADLESS: input.HEADLESS === "false" ? "false" : "true",
    RECIPIENTS: normalizeRecipients(input.RECIPIENTS || "").join(","),
    STARTUP_MESSAGE: sanitizeText(input.STARTUP_MESSAGE, DEFAULT_CONFIG.STARTUP_MESSAGE),
    BULK_SEND_MODE: sanitizeChoice(
      sanitizeText(input.BULK_SEND_MODE, DEFAULT_CONFIG.BULK_SEND_MODE),
      ["instant", "staggered", "random"],
      DEFAULT_CONFIG.BULK_SEND_MODE
    ),
    BULK_DELAY_MS: sanitizeIntegerString(input.BULK_DELAY_MS, 1500, 100, 60000),
    BULK_RANDOM_MIN_MS: sanitizeIntegerString(input.BULK_RANDOM_MIN_MS, 700, 100, 60000),
    BULK_RANDOM_MAX_MS: sanitizeIntegerString(input.BULK_RANDOM_MAX_MS, 2500, 100, 120000),
    BULK_TEMPLATE_MODE: sanitizeChoice(
      sanitizeText(input.BULK_TEMPLATE_MODE, DEFAULT_CONFIG.BULK_TEMPLATE_MODE),
      ["single", "rotate", "random"],
      DEFAULT_CONFIG.BULK_TEMPLATE_MODE
    ),
    BULK_TEMPLATE_LINES: sanitizeMultilineText(input.BULK_TEMPLATE_LINES, DEFAULT_CONFIG.BULK_TEMPLATE_LINES),
    AUTO_REPLY_ENABLED: input.AUTO_REPLY_ENABLED === "false" ? "false" : "true",
    AUTO_REPLY_MODE: sanitizeChoice(
      sanitizeText(input.AUTO_REPLY_MODE, DEFAULT_CONFIG.AUTO_REPLY_MODE),
      ["exact", "contains", "rules"],
      DEFAULT_CONFIG.AUTO_REPLY_MODE
    ),
    AUTO_REPLY_TRIGGER: sanitizeText(input.AUTO_REPLY_TRIGGER, DEFAULT_CONFIG.AUTO_REPLY_TRIGGER).toLowerCase(),
    AUTO_REPLY_TEXT: sanitizeText(input.AUTO_REPLY_TEXT, DEFAULT_CONFIG.AUTO_REPLY_TEXT),
    AUTO_REPLY_RULES: sanitizeMultilineText(input.AUTO_REPLY_RULES, DEFAULT_CONFIG.AUTO_REPLY_RULES),
    SCHEDULE_ENABLED: input.SCHEDULE_ENABLED === "true" ? "true" : "false",
    SCHEDULE_CRON: sanitizeText(input.SCHEDULE_CRON, DEFAULT_CONFIG.SCHEDULE_CRON),
    SCHEDULE_MESSAGE: sanitizeText(input.SCHEDULE_MESSAGE, DEFAULT_CONFIG.SCHEDULE_MESSAGE),
  };

  if (Number(clean.BULK_RANDOM_MAX_MS) < Number(clean.BULK_RANDOM_MIN_MS)) {
    clean.BULK_RANDOM_MAX_MS = clean.BULK_RANDOM_MIN_MS;
  }

  if (!cron.validate(clean.SCHEDULE_CRON)) {
    throw new Error("Invalid cron expression.");
  }

  return clean;
}

function toWorkspaceId(input) {
  const normalized = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || `ws-${Date.now().toString(36)}`;
}

function saveStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(STORE_PATH)) {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    store.workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
  }

  if (store.workspaces.length === 0) {
    store.workspaces.push({
      id: "default",
      name: "Default Workspace",
      config: sanitizeWorkspaceConfig({ ...DEFAULT_CONFIG, ...process.env }),
      reports: [],
      createdAt: new Date().toISOString(),
    });
    saveStore();
    return;
  }

  let changed = false;
  store.workspaces = store.workspaces.map((workspace) => {
    const normalizedConfig = sanitizeWorkspaceConfig({ ...DEFAULT_CONFIG, ...(workspace.config || {}) });
    const normalizedReports = Array.isArray(workspace.reports) ? workspace.reports : [];
    if (JSON.stringify(normalizedConfig) !== JSON.stringify(workspace.config || {})) {
      changed = true;
    }
    if (!Array.isArray(workspace.reports)) {
      changed = true;
    }
    return {
      ...workspace,
      config: normalizedConfig,
      reports: normalizedReports,
    };
  });
  if (changed) {
    saveStore();
  }
}

function getWorkspace(workspaceId) {
  return store.workspaces.find((ws) => ws.id === workspaceId);
}

function appendReport(workspace, entry) {
  if (!Array.isArray(workspace.reports)) {
    workspace.reports = [];
  }
  workspace.reports.push({
    at: new Date().toISOString(),
    ...entry,
  });
  if (workspace.reports.length > MAX_REPORT_ENTRIES) {
    workspace.reports = workspace.reports.slice(-MAX_REPORT_ENTRIES);
  }
  saveStore();
}

function parseIsoInput(input, fallback) {
  if (!input) {
    return fallback;
  }
  const dt = new Date(input);
  if (Number.isNaN(dt.getTime())) {
    return fallback;
  }
  return dt;
}

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
    if (Number.isNaN(at.getTime())) {
      return false;
    }
    return at >= window.from && at <= window.to;
  });
}

function reportSummary(reports) {
  const summary = {
    total: reports.length,
    sentOk: 0,
    sentFailed: 0,
    autoReplies: 0,
    bySource: {},
  };

  for (const entry of reports) {
    if (entry.kind === "outgoing") {
      if (entry.ok) {
        summary.sentOk += 1;
      } else {
        summary.sentFailed += 1;
      }
    }
    if (entry.kind === "auto_reply") {
      summary.autoReplies += 1;
    }
    const source = entry.source || "unknown";
    summary.bySource[source] = (summary.bySource[source] || 0) + 1;
  }
  return summary;
}

function toCsv(rows) {
  const esc = (value) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
  };
  return rows.map((row) => row.map((value) => esc(value)).join(",")).join("\n");
}

function findChromeUnderCache(cacheRoot) {
  if (!cacheRoot || !fs.existsSync(cacheRoot)) {
    return "";
  }

  const queue = [{ dir: cacheRoot, depth: 0 }];
  const maxDepth = 6;
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > maxDepth) {
      continue;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch (_err) {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isFile() && entry.name === "chrome") {
        return fullPath;
      }
      if (entry.isDirectory()) {
        queue.push({ dir: fullPath, depth: current.depth + 1 });
      }
    }
  }

  return "";
}

function resolveChromeExecutablePath() {
  const envPath = (process.env.PUPPETEER_EXECUTABLE_PATH || "").trim();
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const cacheRoot = process.env.PUPPETEER_CACHE_DIR || path.join(process.env.HOME || "/opt/render", ".cache", "puppeteer");
  return findChromeUnderCache(cacheRoot);
}

function getRuntime(workspaceId) {
  if (!runtimeByWorkspaceId.has(workspaceId)) {
    runtimeByWorkspaceId.set(workspaceId, {
      status: "stopped",
      authenticated: false,
      ready: false,
      qrDataUrl: "",
      lastError: "",
      client: null,
      scheduler: null,
    });
  }
  return runtimeByWorkspaceId.get(workspaceId);
}

function workspaceRecipientsChatIds(workspace) {
  return normalizeRecipients(workspace.config.RECIPIENTS || "").map((num) => `${num}@c.us`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTemplateLines(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseAutoReplyRules(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [trigger, ...responseParts] = line.split("=>");
      const response = responseParts.join("=>").trim();
      return {
        trigger: (trigger || "").trim().toLowerCase(),
        response,
      };
    })
    .filter((rule) => rule.trigger && rule.response);
}

function getBulkOptions(config, overrides = {}) {
  const pickOverride = (value, fallback) => {
    if (value === undefined || value === null) {
      return fallback;
    }
    if (typeof value === "string" && value.trim() === "") {
      return fallback;
    }
    return value;
  };

  const mode = sanitizeChoice(
    sanitizeText(pickOverride(overrides.mode, config.BULK_SEND_MODE), DEFAULT_CONFIG.BULK_SEND_MODE),
    ["instant", "staggered", "random"],
    DEFAULT_CONFIG.BULK_SEND_MODE
  );

  const delayMs = Number(
    sanitizeIntegerString(
      pickOverride(overrides.delayMs, config.BULK_DELAY_MS),
      DEFAULT_CONFIG.BULK_DELAY_MS,
      100,
      60000
    )
  );
  const randomMinMs = Number(
    sanitizeIntegerString(
      pickOverride(overrides.randomMinMs, config.BULK_RANDOM_MIN_MS),
      DEFAULT_CONFIG.BULK_RANDOM_MIN_MS,
      100,
      60000
    )
  );
  const randomMaxMs = Number(
    sanitizeIntegerString(
      pickOverride(overrides.randomMaxMs, config.BULK_RANDOM_MAX_MS),
      DEFAULT_CONFIG.BULK_RANDOM_MAX_MS,
      100,
      120000
    )
  );

  const templateMode = sanitizeChoice(
    sanitizeText(
      pickOverride(overrides.templateMode, config.BULK_TEMPLATE_MODE),
      DEFAULT_CONFIG.BULK_TEMPLATE_MODE
    ),
    ["single", "rotate", "random"],
    DEFAULT_CONFIG.BULK_TEMPLATE_MODE
  );
  const templateLines = parseTemplateLines(
    sanitizeMultilineText(
      pickOverride(overrides.templateLines, config.BULK_TEMPLATE_LINES),
      DEFAULT_CONFIG.BULK_TEMPLATE_LINES
    )
  );

  return {
    mode,
    delayMs,
    randomMinMs: Math.min(randomMinMs, randomMaxMs),
    randomMaxMs: Math.max(randomMinMs, randomMaxMs),
    templateMode,
    templateLines,
  };
}

function pickMessage(index, baseMessage, options) {
  const templates = options.templateLines.length > 0 ? options.templateLines : [baseMessage];
  if (options.templateMode === "rotate") {
    return templates[index % templates.length];
  }
  if (options.templateMode === "random") {
    const randomIndex = Math.floor(Math.random() * templates.length);
    return templates[randomIndex];
  }
  return baseMessage;
}

function getInterMessageDelay(options) {
  if (options.mode === "staggered") {
    return options.delayMs;
  }
  if (options.mode === "random") {
    const delta = options.randomMaxMs - options.randomMinMs;
    return options.randomMinMs + Math.floor(Math.random() * (delta + 1));
  }
  return 0;
}

function stopScheduler(runtime) {
  if (runtime.scheduler) {
    runtime.scheduler.stop();
    runtime.scheduler.destroy();
    runtime.scheduler = null;
  }
}

async function sendBulkMessage(workspace, runtime, message, overrides = {}) {
  if (!runtime.client || !runtime.ready) {
    throw new Error("WhatsApp client is not ready.");
  }

  const recipients = workspaceRecipientsChatIds(workspace);
  if (recipients.length === 0) {
    throw new Error("No recipients configured.");
  }

  const options = getBulkOptions(workspace.config, overrides);
  const results = [];
  for (let index = 0; index < recipients.length; index += 1) {
    const chatId = recipients[index];
    const outgoingMessage = pickMessage(index, message, options);
    const interDelayMs = getInterMessageDelay(options);
    const source = sanitizeText(overrides.source, "manual");
    try {
      await runtime.client.sendMessage(chatId, outgoingMessage);
      results.push({ chatId, ok: true, mode: options.mode });
      appendReport(workspace, {
        kind: "outgoing",
        source,
        ok: true,
        mode: options.mode,
        templateMode: options.templateMode,
        chatId,
        message: outgoingMessage,
      });
    } catch (err) {
      results.push({ chatId, ok: false, error: err.message });
      appendReport(workspace, {
        kind: "outgoing",
        source,
        ok: false,
        mode: options.mode,
        templateMode: options.templateMode,
        chatId,
        message: outgoingMessage,
        error: err.message,
      });
    }
    if (interDelayMs > 0 && index < recipients.length - 1) {
      await sleep(interDelayMs);
    }
  }
  return results;
}

function setupScheduler(workspace, runtime) {
  stopScheduler(runtime);

  if (workspace.config.SCHEDULE_ENABLED !== "true") {
    return;
  }

  const expression = workspace.config.SCHEDULE_CRON || DEFAULT_CONFIG.SCHEDULE_CRON;
  if (!cron.validate(expression)) {
    runtime.lastError = `Invalid cron expression: ${expression}`;
    return;
  }

  runtime.scheduler = cron.schedule(expression, async () => {
    try {
      await sendBulkMessage(workspace, runtime, workspace.config.SCHEDULE_MESSAGE || DEFAULT_CONFIG.SCHEDULE_MESSAGE, {
        source: "scheduled",
      });
    } catch (err) {
      runtime.lastError = err.message;
    }
  });
}

function createClientForWorkspace(workspace) {
  const runtime = getRuntime(workspace.id);
  if (runtime.client) {
    return;
  }

  const headless = workspace.config.HEADLESS !== "false";
  const executablePath = resolveChromeExecutablePath();
  runtime.client = new Client({
    authStrategy: new LocalAuth({ clientId: `workspace-${workspace.id}` }),
    puppeteer: {
      headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: executablePath || undefined,
    },
  });

  runtime.client.on("qr", async (qr) => {
    runtime.status = "qr_ready";
    runtime.ready = false;
    try {
      runtime.qrDataUrl = await QRCode.toDataURL(qr);
    } catch (err) {
      runtime.lastError = `QR render failed: ${err.message}`;
    }
  });

  runtime.client.on("authenticated", () => {
    runtime.authenticated = true;
    runtime.status = "authenticated";
  });

  runtime.client.on("ready", () => {
    runtime.status = "ready";
    runtime.ready = true;
    runtime.qrDataUrl = "";
    setupScheduler(workspace, runtime);
  });

  runtime.client.on("message", async (msg) => {
    if (workspace.config.AUTO_REPLY_ENABLED !== "true") {
      return;
    }

    const incomingText = (msg.body || "").trim().toLowerCase();
    const mode = workspace.config.AUTO_REPLY_MODE || DEFAULT_CONFIG.AUTO_REPLY_MODE;
    const trigger = (workspace.config.AUTO_REPLY_TRIGGER || DEFAULT_CONFIG.AUTO_REPLY_TRIGGER).toLowerCase();
    let replyText = "";

    if (mode === "exact" && incomingText === trigger) {
      replyText = workspace.config.AUTO_REPLY_TEXT || DEFAULT_CONFIG.AUTO_REPLY_TEXT;
    }

    if (mode === "contains" && trigger && incomingText.includes(trigger)) {
      replyText = workspace.config.AUTO_REPLY_TEXT || DEFAULT_CONFIG.AUTO_REPLY_TEXT;
    }

    if (mode === "rules") {
      const rules = parseAutoReplyRules(workspace.config.AUTO_REPLY_RULES || "");
      const matched = rules.find((rule) => incomingText.includes(rule.trigger));
      if (matched) {
        replyText = matched.response;
      }
    }

    if (replyText) {
      try {
        await msg.reply(replyText);
        appendReport(workspace, {
          kind: "auto_reply",
          source: "auto_reply",
          ok: true,
          from: msg.from,
          incoming: incomingText,
          message: replyText,
          mode,
        });
      } catch (err) {
        runtime.lastError = err.message;
        appendReport(workspace, {
          kind: "auto_reply",
          source: "auto_reply",
          ok: false,
          from: msg.from,
          incoming: incomingText,
          message: replyText,
          mode,
          error: err.message,
        });
      }
    }
  });

  runtime.client.on("auth_failure", (message) => {
    runtime.lastError = `Auth failure: ${message}`;
    runtime.status = "error";
  });

  runtime.client.on("disconnected", (reason) => {
    runtime.status = `disconnected: ${reason}`;
    runtime.ready = false;
    runtime.authenticated = false;
    runtime.qrDataUrl = "";
    stopScheduler(runtime);
    runtime.client = null;
  });

  runtime.client
    .initialize()
    .catch((err) => {
      runtime.lastError = `Initialize failed: ${err.message}`;
      runtime.status = "error";
      runtime.ready = false;
      runtime.authenticated = false;
      runtime.client = null;
    });
}

async function stopWorkspaceClient(workspaceId) {
  const runtime = getRuntime(workspaceId);
  stopScheduler(runtime);
  if (runtime.client) {
    await runtime.client.destroy();
    runtime.client = null;
  }
  runtime.status = "stopped";
  runtime.ready = false;
  runtime.authenticated = false;
  runtime.qrDataUrl = "";
}

function workspaceSummary(workspace) {
  const runtime = getRuntime(workspace.id);
  return {
    id: workspace.id,
    name: workspace.name,
    status: runtime.status,
    ready: runtime.ready,
    authenticated: runtime.authenticated,
    recipientsCount: workspaceRecipientsChatIds(workspace).length,
    hasScheduler: Boolean(runtime.scheduler),
  };
}

function requireWorkspace(req, res) {
  const workspace = getWorkspace(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ ok: false, error: "Workspace not found." });
    return null;
  }
  return workspace;
}

app.get("/api/workspaces", (_req, res) => {
  res.json({
    workspaces: store.workspaces.map((workspace) => workspaceSummary(workspace)),
  });
});

app.post("/api/workspaces", (req, res) => {
  try {
    const name = sanitizeText(req.body?.name, "New Workspace");
    let id = toWorkspaceId(req.body?.id || name);
    while (getWorkspace(id)) {
      id = `${id}-${Math.floor(Math.random() * 1000)}`;
    }

    const workspace = {
      id,
      name,
      config: { ...DEFAULT_CONFIG },
      reports: [],
      createdAt: new Date().toISOString(),
    };

    store.workspaces.push(workspace);
    saveStore();

    res.json({ ok: true, workspace: workspaceSummary(workspace) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/api/workspaces/:workspaceId/config", (req, res) => {
  const workspace = requireWorkspace(req, res);
  if (!workspace) {
    return;
  }
  res.json(workspace.config);
});

app.post("/api/workspaces/:workspaceId/config", (req, res) => {
  const workspace = requireWorkspace(req, res);
  if (!workspace) {
    return;
  }

  try {
    workspace.config = sanitizeWorkspaceConfig(req.body || {});
    saveStore();

    const runtime = getRuntime(workspace.id);
    if (runtime.ready) {
      setupScheduler(workspace, runtime);
    }

    res.json({ ok: true, config: workspace.config });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/api/workspaces/:workspaceId/status", (req, res) => {
  const workspace = requireWorkspace(req, res);
  if (!workspace) {
    return;
  }

  const runtime = getRuntime(workspace.id);
  res.json({
    status: runtime.status,
    ready: runtime.ready,
    authenticated: runtime.authenticated,
    qrDataUrl: runtime.qrDataUrl,
    hasScheduler: Boolean(runtime.scheduler),
    recipientsCount: workspaceRecipientsChatIds(workspace).length,
    lastError: runtime.lastError,
  });
});

app.post("/api/workspaces/:workspaceId/start", (req, res) => {
  const workspace = requireWorkspace(req, res);
  if (!workspace) {
    return;
  }

  const runtime = getRuntime(workspace.id);
  if (runtime.client && runtime.ready) {
    res.json({ ok: true, status: runtime.status });
    return;
  }

  runtime.status = "starting";
  runtime.lastError = "";
  createClientForWorkspace(workspace);
  res.json({ ok: true, status: runtime.status });
});

app.post("/api/workspaces/:workspaceId/stop", async (req, res) => {
  const workspace = requireWorkspace(req, res);
  if (!workspace) {
    return;
  }

  try {
    await stopWorkspaceClient(workspace.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/workspaces/:workspaceId/send-startup", async (req, res) => {
  const workspace = requireWorkspace(req, res);
  if (!workspace) {
    return;
  }

  try {
    const runtime = getRuntime(workspace.id);
    const message = workspace.config.STARTUP_MESSAGE || DEFAULT_CONFIG.STARTUP_MESSAGE;
    const results = await sendBulkMessage(workspace, runtime, message, { source: "startup" });
    res.json({ ok: true, message, results });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/workspaces/:workspaceId/send-custom", async (req, res) => {
  const workspace = requireWorkspace(req, res);
  if (!workspace) {
    return;
  }

  try {
    const runtime = getRuntime(workspace.id);
    const message = sanitizeText(req.body?.message, "");
    if (!message) {
      res.status(400).json({ ok: false, error: "Message is required." });
      return;
    }

    const results = await sendBulkMessage(workspace, runtime, message, {
      source: "custom",
      mode: req.body?.mode,
      delayMs: req.body?.delayMs,
      randomMinMs: req.body?.randomMinMs,
      randomMaxMs: req.body?.randomMaxMs,
      templateMode: req.body?.templateMode,
      templateLines: req.body?.templateLines,
    });
    res.json({ ok: true, message, results });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/api/workspaces/:workspaceId/reports/summary", (req, res) => {
  const workspace = requireWorkspace(req, res);
  if (!workspace) {
    return;
  }
  const window = getReportWindow(req.query || {});
  const reports = getWorkspaceReports(workspace, window);
  res.json({
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    summary: reportSummary(reports),
  });
});

app.get("/api/workspaces/:workspaceId/reports/logs", (req, res) => {
  const workspace = requireWorkspace(req, res);
  if (!workspace) {
    return;
  }
  const window = getReportWindow(req.query || {});
  const limit = Math.min(1000, Math.max(1, Number.parseInt(String(req.query?.limit || "200"), 10) || 200));
  const reports = getWorkspaceReports(workspace, window)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
  res.json({
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    logs: reports,
  });
});

app.get("/api/workspaces/:workspaceId/reports/csv", (req, res) => {
  const workspace = requireWorkspace(req, res);
  if (!workspace) {
    return;
  }
  const window = getReportWindow(req.query || {});
  const reports = getWorkspaceReports(workspace, window).sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );
  const csv = toCsv([
    ["at", "kind", "source", "ok", "mode", "templateMode", "chatId", "from", "incoming", "message", "error"],
    ...reports.map((entry) => [
      entry.at,
      entry.kind,
      entry.source,
      String(entry.ok),
      entry.mode || "",
      entry.templateMode || "",
      entry.chatId || "",
      entry.from || "",
      entry.incoming || "",
      entry.message || "",
      entry.error || "",
    ]),
  ]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=\"${workspace.id}-reports.csv\"`);
  res.send(csv);
});

app.listen(PORT, () => {
  ensureStore();
  console.log(`Web app running at http://localhost:${PORT}`);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});
