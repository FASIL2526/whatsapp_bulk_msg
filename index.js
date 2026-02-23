require("dotenv").config();

const fs = require("fs");
const path = require("path");
const os = require("os");
const express = require("express");
const cron = require("node-cron");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { install: installBrowser } = require("@puppeteer/browsers");
const multer = require("multer");
const XLSX = require("xlsx");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { DEFAULT_CONFIG } = require("./src/config/default-config");
const { configureRuntimeEnv, SYSTEM_CHROME_CANDIDATES } = require("./src/config/runtime-env");
const {
  normalizeRecipients,
  sanitizeText,
  sanitizeChoice,
  sanitizeIntegerString,
  sanitizeWorkspaceConfig,
} = require("./src/utils/workspace-config");
const {
  getConversationHistory,
  pushToConversationHistory,
  formatHistoryForPrompt,
} = require("./src/services/conversation-memory");

configureRuntimeEnv();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const PORT = Number(process.env.PORT || 4000);
const HOST =
  process.env.HOST ||
  (process.env.NODE_ENV === "production" || process.env.RENDER === "true" ? "0.0.0.0" : "127.0.0.1");
const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "workspaces.json");
const MAX_REPORT_ENTRIES = 5000;
const AUTH_SECRET = process.env.AUTH_SECRET || "restartx-dev-secret-change-me";
const TOKEN_TTL = process.env.TOKEN_TTL || "7d";

const SERVER_STARTED_AT = new Date().toLocaleString();
console.log(`[SYSTEM] Server process starting at: ${SERVER_STARTED_AT}`);

const store = {
  users: [],
  workspaces: [],
};

const runtimeByWorkspaceId = new Map();
let followUpSweepInProgress = false;

const ROLE_RANK = {
  member: 1,
  admin: 2,
  owner: 3,
};

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

function safeUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
  };
}

function getUserById(userId) {
  return store.users.find((user) => user.id === userId);
}

function getUserByUsername(username) {
  return store.users.find((user) => user.username === username);
}

function ensureBootstrapAdmin() {
  const adminUsername = normalizeUsername(process.env.ADMIN_USERNAME || "admin");
  const adminPassword = String(process.env.ADMIN_PASSWORD || "admin12345");
  if (!adminUsername) {
    throw new Error("Invalid ADMIN_USERNAME");
  }
  let admin = getUserByUsername(adminUsername);
  if (!admin) {
    admin = {
      id: `u_${Date.now().toString(36)}`,
      username: adminUsername,
      passwordHash: bcrypt.hashSync(adminPassword, 10),
      createdAt: new Date().toISOString(),
    };
    store.users.push(admin);
  }
  return admin;
}

function workspaceMember(workspace, userId) {
  const members = Array.isArray(workspace.members) ? workspace.members : [];
  return members.find((member) => member.userId === userId) || null;
}

function hasWorkspaceRole(workspace, userId, minRole = "member") {
  const member = workspaceMember(workspace, userId);
  if (!member) {
    return false;
  }
  const current = ROLE_RANK[member.role] || 0;
  const required = ROLE_RANK[minRole] || 0;
  return current >= required;
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
    store.users = Array.isArray(parsed.users) ? parsed.users : [];
    store.workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
  }

  const adminUser = ensureBootstrapAdmin();

  if (store.workspaces.length === 0) {
    store.workspaces.push({
      id: "default",
      name: "Default Workspace",
      config: sanitizeWorkspaceConfig({ ...DEFAULT_CONFIG, ...process.env }),
      reports: [],
      leads: [],
      members: [{ userId: adminUser.id, role: "owner" }],
      createdAt: new Date().toISOString(),
    });
    saveStore();
    return;
  }

  let changed = false;
  store.workspaces = store.workspaces.map((workspace) => {
    const normalizedConfig = sanitizeWorkspaceConfig({ ...DEFAULT_CONFIG, ...(workspace.config || {}) });
    const normalizedReports = Array.isArray(workspace.reports) ? workspace.reports : [];
    const normalizedMembers = Array.isArray(workspace.members) ? workspace.members : [];
    const normalizedLeads = Array.isArray(workspace.leads) ? workspace.leads : [];
    if (JSON.stringify(normalizedConfig) !== JSON.stringify(workspace.config || {})) {
      changed = true;
    }
    if (!Array.isArray(workspace.reports)) {
      changed = true;
    }
    if (!Array.isArray(workspace.members)) {
      changed = true;
    }
    if (!Array.isArray(workspace.leads)) {
      changed = true;
    }
    if (normalizedMembers.length === 0) {
      normalizedMembers.push({ userId: adminUser.id, role: "owner" });
      changed = true;
    }
    return {
      ...workspace,
      config: normalizedConfig,
      reports: normalizedReports,
      members: normalizedMembers,
      leads: normalizedLeads,
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
    followUps: 0,
    autoStatuses: 0,
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
    if (entry.kind === "auto_follow_up") {
      summary.followUps += 1;
    }
    if (entry.kind === "auto_status") {
      summary.autoStatuses += 1;
    }
    const source = entry.source || "unknown";
    summary.bySource[source] = (summary.bySource[source] || 0) + 1;
  }
  return summary;
}

function parseAiJsonResponse(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    throw new Error("Empty AI response");
  }
  const jsonStr = text.match(/{[\s\S]*}/)?.[0] || text;
  return JSON.parse(jsonStr);
}

function normalizeAiDecision(aiData, fallbackReply) {
  const data = aiData && typeof aiData === "object" ? aiData : {};
  const reply = String(data.reply || fallbackReply || "").trim();
  const status = sanitizeChoice(data.status, ["cold", "warm", "hot"], "cold");
  const reason = sanitizeText(data.reason, "No reason provided.");
  const detectedLanguage = sanitizeText(data.language, "same_as_customer");
  const stage = sanitizeChoice(
    sanitizeText(data.stage, ""),
    ["new", "qualified", "proposal", "booking", "closed_won", "closed_lost"],
    ""
  );
  const needsClarification = String(data.needs_clarification || "")
    .trim()
    .toLowerCase() === "true" || data.needs_clarification === true;
  const clarificationQuestion = sanitizeText(data.clarification_question, "");
  const closeQuestion = sanitizeText(data.close_question, "");
  const primaryObjection = sanitizeText(data.primary_objection, "");
  const intentScore = Math.min(
    100,
    Math.max(0, Number.parseInt(String(data.intent_score ?? ""), 10) || 0)
  );
  const qualification = data.qualification && typeof data.qualification === "object"
    ? {
      need: sanitizeText(data.qualification.need, ""),
      budget: sanitizeText(data.qualification.budget, ""),
      timeline: sanitizeText(data.qualification.timeline, ""),
      decision_maker: sanitizeText(data.qualification.decision_maker, ""),
    }
    : {
      need: "",
      budget: "",
      timeline: "",
      decision_maker: "",
    };
  const missingQualificationFields = Array.isArray(data.missing_fields)
    ? data.missing_fields.map((field) => sanitizeText(field, "").toLowerCase()).filter(Boolean)
    : [];
  const finalReply = needsClarification
    ? (clarificationQuestion || reply || "Could you clarify what you need so I can help you better?")
    : reply;

  return {
    reply: finalReply,
    status,
    reason,
    language: detectedLanguage,
    stage,
    intentScore,
    closeQuestion,
    primaryObjection,
    qualification,
    missingQualificationFields,
    needsClarification,
  };
}

function parseList(raw) {
  return String(raw || "")
    .split(/[,\n]/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function qualificationCompletion(qualification) {
  const q = qualification || {};
  const fields = ["need", "budget", "timeline", "decision_maker"];
  const complete = fields.filter((field) => String(q[field] || "").trim().length > 0).length;
  return {
    complete,
    total: fields.length,
    ratio: complete / fields.length,
  };
}

function scoreLeadDecision(input) {
  const status = sanitizeChoice(input.status, ["cold", "warm", "hot"], "cold");
  const text = String(input.incomingText || "").toLowerCase();
  const completion = qualificationCompletion(input.qualification);
  const hasBuySignal = /(price|cost|book|demo|trial|buy|purchase|start|call|meeting|plan)/i.test(text);
  const hasDelaySignal = /(later|maybe|not now|busy|next month|next week|thinking)/i.test(text);
  let score = status === "hot" ? 75 : status === "warm" ? 50 : 20;
  score += Math.round(completion.ratio * 20);
  score += hasBuySignal ? 10 : 0;
  score -= hasDelaySignal ? 10 : 0;
  if (input.needsClarification) {
    score -= 8;
  }
  if (Number.isFinite(input.intentScore) && input.intentScore > 0) {
    score = Math.round((score * 0.5) + (input.intentScore * 0.5));
  }
  return Math.min(100, Math.max(0, score));
}

function deriveLeadStage(currentStage, score, status, bookingLink) {
  const explicit = sanitizeChoice(
    sanitizeText(currentStage, ""),
    ["new", "qualified", "proposal", "booking", "closed_won", "closed_lost"],
    ""
  );
  if (explicit) {
    return explicit;
  }
  if (status === "hot" && score >= 85) {
    return bookingLink ? "booking" : "proposal";
  }
  if (status === "hot" || score >= 65) {
    return "proposal";
  }
  if (status === "warm" || score >= 45) {
    return "qualified";
  }
  return "new";
}

function shouldAskCloseQuestion(config, status, score, needsClarification) {
  if (needsClarification) {
    return false;
  }
  const mode = sanitizeChoice(
    sanitizeText(config.AI_CLOSE_QUESTION_MODE, DEFAULT_CONFIG.AI_CLOSE_QUESTION_MODE),
    ["off", "hot_only", "warm_hot", "always"],
    DEFAULT_CONFIG.AI_CLOSE_QUESTION_MODE
  );
  if (mode === "off") {
    return false;
  }
  if (mode === "always") {
    return true;
  }
  if (mode === "hot_only") {
    return status === "hot" || score >= 75;
  }
  return status === "warm" || status === "hot" || score >= 55;
}

function buildSalesReplyFromDecision(normalized, config, score) {
  let reply = String(normalized.reply || "").trim();
  if (!reply) {
    return "";
  }
  const shouldClose = shouldAskCloseQuestion(config, normalized.status, score, normalized.needsClarification);
  if (!shouldClose) {
    return reply;
  }
  const closeQuestion = sanitizeText(normalized.closeQuestion, "");
  if (!closeQuestion) {
    return reply;
  }

  const shouldAddStory = config.AI_AUTO_STORY_TO_CLOSE === "true";
  const story = sanitizeText(config.AI_CLOSING_STORY, "");
  const includeStatusFeatures = config.AI_WHATSAPP_STATUS_FEATURES === "true";
  const statusFeaturesText = sanitizeText(
    config.AI_WHATSAPP_STATUS_FEATURES_TEXT,
    DEFAULT_CONFIG.AI_WHATSAPP_STATUS_FEATURES_TEXT
  );
  if (shouldAddStory && story) {
    reply = `${reply} ${story}`;
  }
  if (includeStatusFeatures && statusFeaturesText) {
    reply = `${reply} ${statusFeaturesText}`;
  }
  return `${reply} ${closeQuestion}`.replace(/\s+/g, " ").trim();
}

function nextFollowUpAt(config, fromDate = new Date()) {
  if (config.AI_FOLLOW_UP_ENABLED !== "true") {
    return "";
  }
  const delayMinutes = Math.max(5, Number.parseInt(config.AI_FOLLOW_UP_DELAY_MINUTES || "180", 10) || 180);
  return new Date(fromDate.getTime() + (delayMinutes * 60 * 1000)).toISOString();
}

function buildFollowUpMessage(workspace, lead) {
  const template = sanitizeText(
    workspace.config.AI_FOLLOW_UP_TEMPLATE,
    DEFAULT_CONFIG.AI_FOLLOW_UP_TEMPLATE
  );
  const bookingLink = sanitizeText(workspace.config.AI_BOOKING_LINK, "");
  const includeStory = workspace.config.AI_AUTO_STORY_TO_CLOSE === "true";
  const story = sanitizeText(workspace.config.AI_CLOSING_STORY, "");
  const includeStatusFeatures = workspace.config.AI_WHATSAPP_STATUS_FEATURES === "true";
  const statusFeaturesText = sanitizeText(
    workspace.config.AI_WHATSAPP_STATUS_FEATURES_TEXT,
    DEFAULT_CONFIG.AI_WHATSAPP_STATUS_FEATURES_TEXT
  );
  const closeQuestion = bookingLink
    ? `Would you like to book a quick call here: ${bookingLink}?`
    : "Would you like me to prepare the next step for you now?";

  const parts = [template];
  if (includeStory && story) {
    parts.push(story);
  }
  if (includeStatusFeatures && statusFeaturesText) {
    parts.push(statusFeaturesText);
  }
  if (shouldAskCloseQuestion(workspace.config, lead.status, lead.score || 0, false)) {
    parts.push(closeQuestion);
  }
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function localLeadSeekingStatusText(workspace) {
  const cfg = workspace.config || DEFAULT_CONFIG;
  const tone = sanitizeChoice(
    sanitizeText(cfg.AI_STATUS_AUTOPILOT_TONE, DEFAULT_CONFIG.AI_STATUS_AUTOPILOT_TONE),
    ["direct", "friendly", "consultative"],
    DEFAULT_CONFIG.AI_STATUS_AUTOPILOT_TONE
  );
  const cta = sanitizeText(cfg.AI_STATUS_AUTOPILOT_CTA, DEFAULT_CONFIG.AI_STATUS_AUTOPILOT_CTA);
  const knowledgeRaw = sanitizeText(cfg.AI_PRODUCT_KNOWLEDGE, DEFAULT_CONFIG.AI_PRODUCT_KNOWLEDGE);
  const knowledgeSentence = knowledgeRaw.split(/[.!?]/).map((s) => s.trim()).filter(Boolean)[0] || knowledgeRaw;

  if (tone === "friendly") {
    return `Helping businesses grow with smarter WhatsApp outreach. ${knowledgeSentence}. ${cta}`;
  }
  if (tone === "consultative") {
    return `If you're evaluating better WhatsApp lead handling, here's what we solve: ${knowledgeSentence}. ${cta}`;
  }
  return `Need more qualified leads from WhatsApp? ${knowledgeSentence}. ${cta}`;
}

async function generateLeadSeekingStatusContent(workspace) {
  const cfg = workspace.config || DEFAULT_CONFIG;
  const useAi = cfg.AI_STATUS_AUTOPILOT_USE_AI !== "false";
  const apiKey = sanitizeText(cfg.AI_API_KEY, "");
  const provider = sanitizeChoice(cfg.AI_PROVIDER, ["google", "openrouter"], "google");
  const modelName = sanitizeText(cfg.AI_MODEL, DEFAULT_CONFIG.AI_MODEL);
  const fallback = localLeadSeekingStatusText(workspace);

  if (!useAi || !apiKey) {
    return { text: fallback, source: "status_local" };
  }

  const prompt = `
Create one short WhatsApp Status update to attract lead inquiries.
Constraints:
- 1-3 sentences max.
- Sound human, non-spammy, and high-conversion.
- Include a clear CTA.
- Use this tone: ${sanitizeText(cfg.AI_STATUS_AUTOPILOT_TONE, DEFAULT_CONFIG.AI_STATUS_AUTOPILOT_TONE)}.
- Product context: ${sanitizeText(cfg.AI_PRODUCT_KNOWLEDGE, DEFAULT_CONFIG.AI_PRODUCT_KNOWLEDGE)}
- CTA guidance: ${sanitizeText(cfg.AI_STATUS_AUTOPILOT_CTA, DEFAULT_CONFIG.AI_STATUS_AUTOPILOT_CTA)}
- If helpful, include this angle: ${sanitizeText(cfg.AI_WHATSAPP_STATUS_FEATURES_TEXT, DEFAULT_CONFIG.AI_WHATSAPP_STATUS_FEATURES_TEXT)}

Return JSON only:
{
  "status_text": "final status content"
}
`;

  try {
    if (provider === "google") {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const raw = result.response.text().trim();
      const parsed = parseAiJsonResponse(raw);
      return {
        text: sanitizeText(parsed.status_text, fallback),
        source: "status_ai_google",
      };
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: "Return JSON only." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || "OpenRouter status generation error");
    }
    const raw = data?.choices?.[0]?.message?.content || "";
    const parsed = parseAiJsonResponse(raw);
    return {
      text: sanitizeText(parsed.status_text, fallback),
      source: "status_ai_openrouter",
    };
  } catch (err) {
    return {
      text: fallback,
      source: "status_local_fallback",
      warning: err.message,
    };
  }
}

async function postLeadSeekingStatus(workspace, runtime, triggerSource = "status_autopilot") {
  if (!runtime.client || (!runtime.ready && !runtime.authenticated)) {
    throw new Error("WhatsApp client is not connected yet.");
  }
  const generated = await generateLeadSeekingStatusContent(workspace);
  const text = sanitizeText(generated.text, "");
  if (!text) {
    throw new Error("Generated status text is empty.");
  }

  await runtime.client.sendMessage("status@broadcast", text);
  appendReport(workspace, {
    kind: "auto_status",
    source: triggerSource,
    ok: true,
    message: text,
    mode: generated.source,
    error: generated.warning || "",
  });
  return { text, mode: generated.source, warning: generated.warning || "" };
}

function buildLocalAiAssistDraft(input) {
  const business = sanitizeText(input.businessName, "Our business");
  const offer = sanitizeText(input.offer, "a service that improves response speed and conversion");
  const audience = sanitizeText(input.targetAudience, "qualified leads");
  const tone = sanitizeChoice(
    sanitizeText(input.tone, "balanced").toLowerCase(),
    ["direct", "friendly", "consultative", "balanced"],
    "balanced"
  );
  const goal = sanitizeText(input.goal, "book qualified calls");

  const toneLine =
    tone === "direct"
      ? "Use short, confident replies with clear CTAs."
      : tone === "friendly"
        ? "Use warm, helpful language with low-pressure CTAs."
        : tone === "consultative"
          ? "Lead with discovery questions, then position value."
          : "Balance value framing, proof, and clear next actions.";

  return {
    productKnowledge: [
      `Business: ${business}.`,
      `Primary offer: ${offer}.`,
      `Target audience: ${audience}.`,
      `Primary conversion goal: ${goal}.`,
      toneLine,
    ].join(" "),
    closingStory: `A recent ${audience} client used ${business} and moved from low reply rates to consistent qualified meetings within two weeks by using structured WhatsApp follow-ups.`,
    objectionPlaybook: [
      "Price objection: Confirm the concern, compare expected ROI, then offer a small pilot.",
      "Trust objection: Share a short proof story and define a low-risk next step.",
      "Timing objection: Offer a phased start and clarify minimal setup effort.",
      "Need objection: Reframe around current pain and measurable outcomes.",
    ].join("\n"),
    followUpTemplate: "Quick follow-up: want me to map the fastest setup path for your use case?",
    statusFeaturesText: "We also use WhatsApp Status features to publish updates/offers and bring in additional inbound conversations.",
    qualificationFields: "need,budget,timeline,decision-maker",
    closingFlow: "balanced",
    closeQuestionMode: "warm_hot",
    autoStoryToClose: "true",
    whatsappStatusFeatures: "true",
    followUpEnabled: "true",
  };
}

async function generateAiAssistDraft(payload, workspaceConfig) {
  const baseDraft = buildLocalAiAssistDraft(payload);
  const provider = sanitizeChoice(
    sanitizeText(payload.provider || workspaceConfig.AI_PROVIDER, "google"),
    ["google", "openrouter"],
    "google"
  );
  const modelName = sanitizeText(payload.model || workspaceConfig.AI_MODEL, DEFAULT_CONFIG.AI_MODEL);
  const apiKey = sanitizeText(payload.apiKey || workspaceConfig.AI_API_KEY, "");
  if (!apiKey) {
    return { draft: baseDraft, source: "local_fallback_no_key" };
  }

  const prompt = `
Create a sales-assistant configuration JSON for WhatsApp closing.
Business: ${sanitizeText(payload.businessName, "")}
Offer: ${sanitizeText(payload.offer, "")}
Target Audience: ${sanitizeText(payload.targetAudience, "")}
Goal: ${sanitizeText(payload.goal, "")}
Preferred Tone: ${sanitizeText(payload.tone, "balanced")}

Return JSON only:
{
  "productKnowledge": "string",
  "closingStory": "string",
  "objectionPlaybook": "multiline string",
  "followUpTemplate": "string",
  "statusFeaturesText": "string",
  "qualificationFields": "need,budget,timeline,decision-maker",
  "closingFlow": "balanced|direct|consultative",
  "closeQuestionMode": "off|hot_only|warm_hot|always",
  "autoStoryToClose": "true|false",
  "whatsappStatusFeatures": "true|false",
  "followUpEnabled": "true|false"
}
`;

  try {
    if (provider === "google") {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const textResponse = result.response.text().trim();
      const parsed = parseAiJsonResponse(textResponse);
      return {
        source: "ai_google",
        draft: {
          ...baseDraft,
          productKnowledge: sanitizeMultilineText(parsed.productKnowledge, baseDraft.productKnowledge),
          closingStory: sanitizeText(parsed.closingStory, baseDraft.closingStory),
          objectionPlaybook: sanitizeMultilineText(parsed.objectionPlaybook, baseDraft.objectionPlaybook),
          followUpTemplate: sanitizeText(parsed.followUpTemplate, baseDraft.followUpTemplate),
          statusFeaturesText: sanitizeText(parsed.statusFeaturesText, baseDraft.statusFeaturesText),
          qualificationFields: sanitizeText(parsed.qualificationFields, baseDraft.qualificationFields),
          closingFlow: sanitizeChoice(parsed.closingFlow, ["balanced", "direct", "consultative"], baseDraft.closingFlow),
          closeQuestionMode: sanitizeChoice(
            parsed.closeQuestionMode,
            ["off", "hot_only", "warm_hot", "always"],
            baseDraft.closeQuestionMode
          ),
          autoStoryToClose: sanitizeChoice(parsed.autoStoryToClose, ["true", "false"], baseDraft.autoStoryToClose),
          whatsappStatusFeatures: sanitizeChoice(
            parsed.whatsappStatusFeatures,
            ["true", "false"],
            baseDraft.whatsappStatusFeatures
          ),
          followUpEnabled: sanitizeChoice(parsed.followUpEnabled, ["true", "false"], baseDraft.followUpEnabled),
        },
      };
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: "system",
            content: "You are a sales-ops assistant. Return only JSON.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || "OpenRouter error");
    }
    const rawContent = data?.choices?.[0]?.message?.content || "";
    const parsed = parseAiJsonResponse(rawContent);
    return {
      source: "ai_openrouter",
      draft: {
        ...baseDraft,
        productKnowledge: sanitizeMultilineText(parsed.productKnowledge, baseDraft.productKnowledge),
        closingStory: sanitizeText(parsed.closingStory, baseDraft.closingStory),
        objectionPlaybook: sanitizeMultilineText(parsed.objectionPlaybook, baseDraft.objectionPlaybook),
        followUpTemplate: sanitizeText(parsed.followUpTemplate, baseDraft.followUpTemplate),
        statusFeaturesText: sanitizeText(parsed.statusFeaturesText, baseDraft.statusFeaturesText),
        qualificationFields: sanitizeText(parsed.qualificationFields, baseDraft.qualificationFields),
        closingFlow: sanitizeChoice(parsed.closingFlow, ["balanced", "direct", "consultative"], baseDraft.closingFlow),
        closeQuestionMode: sanitizeChoice(
          parsed.closeQuestionMode,
          ["off", "hot_only", "warm_hot", "always"],
          baseDraft.closeQuestionMode
        ),
        autoStoryToClose: sanitizeChoice(parsed.autoStoryToClose, ["true", "false"], baseDraft.autoStoryToClose),
        whatsappStatusFeatures: sanitizeChoice(
          parsed.whatsappStatusFeatures,
          ["true", "false"],
          baseDraft.whatsappStatusFeatures
        ),
        followUpEnabled: sanitizeChoice(parsed.followUpEnabled, ["true", "false"], baseDraft.followUpEnabled),
      },
    };
  } catch (err) {
    return {
      source: "local_fallback_error",
      warning: err.message,
      draft: baseDraft,
    };
  }
}

function messageSerializedId(message) {
  return String(message?.id?._serialized || "");
}

async function syncConversationHistoryFromChat(workspace, runtime, msg, maxTurns) {
  try {
    if (!runtime.historySyncedContacts) {
      runtime.historySyncedContacts = new Set();
    }
    const contactId = String(msg.from || "");
    if (!contactId || runtime.historySyncedContacts.has(contactId)) {
      return;
    }

    const chat = await msg.getChat();
    const fetchLimit = Math.max(40, (maxTurns * 2) + 20);
    const recentMessages = await chat.fetchMessages({ limit: fetchLimit });
    const currentMessageId = messageSerializedId(msg);
    const sorted = (recentMessages || [])
      .filter((item) => item && typeof item.body === "string" && item.body.trim())
      .filter((item) => messageSerializedId(item) !== currentMessageId)
      .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

    for (const item of sorted) {
      const role = item.fromMe ? "assistant" : "user";
      pushToConversationHistory(workspace.id, contactId, role, item.body, maxTurns);
    }

    runtime.historySyncedContacts.add(contactId);
  } catch (err) {
    console.log(`[${workspace.id}] History sync skipped: ${err.message}`);
  }
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

function resolveSystemChromeExecutablePath(skipPaths = []) {
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && !skipPaths.includes(candidate)) {
      return candidate;
    }
  }
  return "";
}

function resolveChromeExecutablePath(options = {}) {
  const includeSystem = options.includeSystem !== false;
  const preferSystem = options.preferSystem !== false;
  const ignoreEnv = options.ignoreEnv === true;
  const skipPaths = options.skipPaths || [];

  if (includeSystem && preferSystem) {
    const systemChrome = resolveSystemChromeExecutablePath(skipPaths);
    if (systemChrome) {
      return systemChrome;
    }
  }

  const envPath = ignoreEnv ? "" : (process.env.PUPPETEER_EXECUTABLE_PATH || "").trim();
  if (envPath && fs.existsSync(envPath) && !skipPaths.includes(envPath)) {
    return envPath;
  }

  const cacheCandidates = [
    process.env.PUPPETEER_CACHE_DIR,
    "/workspace/.cache/puppeteer",
    "/opt/render/.cache/puppeteer",
    "/opt/render/project/.cache/puppeteer",
    "/opt/render/project/src/.cache/puppeteer",
    path.join(process.env.HOME || "/opt/render", ".cache", "puppeteer"),
  ].filter(Boolean);

  for (const cacheRoot of cacheCandidates) {
    const found = findChromeUnderCache(cacheRoot);
    if (found) {
      return found;
    }
  }

  if (includeSystem) {
    const systemChrome = resolveSystemChromeExecutablePath();
    if (systemChrome) {
      return systemChrome;
    }
  }

  return "";
}

function chromeDebugInfo() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH || "",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    process.env.PUPPETEER_CACHE_DIR || "",
    "/workspace/.cache/puppeteer",
    "/opt/render/.cache/puppeteer",
    "/opt/render/project/.cache/puppeteer",
    "/opt/render/project/src/.cache/puppeteer",
  ].filter(Boolean);

  return {
    render: process.env.RENDER === "true",
    puppeteerCacheDir: process.env.PUPPETEER_CACHE_DIR || "",
    resolvedExecutablePath: resolveChromeExecutablePath(),
    candidatePaths: candidates,
  };
}

function statusHint(lastError) {
  const msg = String(lastError || "");
  if (!msg) {
    return "";
  }
  if (msg.includes("Could not find Chrome")) {
    return "Chrome is missing on host. Verify Render build installs Chrome and cache path is set.";
  }
  if (msg.includes("Target.setAutoAttach") || msg.includes("Target closed")) {
    return "Chrome started then crashed. Try HEADLESS=true and ensure sandbox/dev-shm flags are enabled.";
  }
  if (msg.includes("The browser is already running for")) {
    return "Session profile is locked by another Chromium process. Stop the old process or clear stale session lock files.";
  }
  if (msg.includes("error while loading shared libraries")) {
    return "Chrome binary cannot start due to missing OS packages. Install browser runtime libraries (for Debian/Ubuntu: libatk1.0-0 libnss3 libx11-6 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2) or use a Puppeteer-ready container image.";
  }
  if (msg.includes("Timed out after waiting 30000ms")) {
    return "Browser startup timed out. On small VPS instances, increase launch/auth timeouts and keep HEADLESS=true.";
  }
  return "";
}

function clearStaleProfileLocks(workspaceId) {
  const sessionDir = path.join(process.cwd(), ".wwebjs_auth", `session-workspace-${workspaceId}`);
  const lockFiles = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

  for (const file of lockFiles) {
    const target = path.join(sessionDir, file);
    if (fs.existsSync(target)) {
      try {
        fs.rmSync(target, { force: true });
      } catch (_err) {
        // Ignore lock cleanup failures; launch will report if still blocked.
      }
    }
  }
}

async function ensureChromeExecutablePath(runtime) {
  const forceSystemChrome = runtime && runtime._forceSystemChrome === true;
  const forceManagedChrome = runtime && runtime._forceManagedChrome === true;
  const skipPaths = runtime && runtime._failingChromePaths ? runtime._failingChromePaths : [];

  const existing = resolveChromeExecutablePath({
    includeSystem: !forceManagedChrome,
    preferSystem: !forceManagedChrome,
    ignoreEnv: forceSystemChrome || forceManagedChrome,
    skipPaths,
  });
  if (existing) {
    return existing;
  }

  const allowInstall = process.env.AUTO_INSTALL_CHROME !== "false" || forceManagedChrome;
  if (!allowInstall) {
    return "";
  }

  const cacheDir = process.env.PUPPETEER_CACHE_DIR || (fs.existsSync("/workspace") ? "/workspace/.cache/puppeteer" : "/opt/render/.cache/puppeteer");
  const buildId = process.env.CHROME_BUILD_ID || "145.0.7632.77";

  try {
    await installBrowser({
      browser: "chrome",
      buildId,
      cacheDir,
    });
  } catch (err) {
    if (runtime) {
      runtime.lastError = `Chrome auto-install failed: ${err.message}`;
    }
    return "";
  }

  const managed = resolveChromeExecutablePath({
    includeSystem: false,
    preferSystem: false,
    ignoreEnv: true,
    skipPaths,
  });
  if (managed) {
    return managed;
  }
  if (forceManagedChrome) {
    return "";
  }
  return resolveChromeExecutablePath({
    includeSystem: true,
    preferSystem: true,
    ignoreEnv: forceSystemChrome || forceManagedChrome,
    skipPaths,
  });
}

function getRuntime(workspaceId) {
  if (!runtimeByWorkspaceId.has(workspaceId)) {
    runtimeByWorkspaceId.set(workspaceId, {
      status: "stopped",
      authenticated: false,
      ready: false,
      startRequestedAt: null,
      qrDataUrl: "",
      lastError: "",
      client: null,
      scheduler: null,
      statusScheduler: null,
      sendInProgress: false,
      sendStartedAt: null,
      historySyncedContacts: new Set(),
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
  if (runtime.statusScheduler) {
    runtime.statusScheduler.stop();
    runtime.statusScheduler.destroy();
    runtime.statusScheduler = null;
  }
}

function markWorkspaceReady(workspace, runtime) {
  if (runtime.ready) {
    return;
  }
  runtime.status = "ready";
  runtime.ready = true;
  runtime.startRequestedAt = null;
  runtime.qrDataUrl = "";
  setupScheduler(workspace, runtime);
  setupStatusScheduler(workspace, runtime);
}

function stopReadyProbe(runtime) {
  if (runtime.readyProbeTimer) {
    clearInterval(runtime.readyProbeTimer);
    runtime.readyProbeTimer = null;
  }
}

async function restartClientBridge(workspace, runtime, reason) {
  if (runtime.recoveryInProgress) {
    return;
  }
  runtime.recoveryInProgress = true;
  runtime.lastError = reason;
  runtime.status = "restarting_bridge";
  stopReadyProbe(runtime);
  try {
    if (runtime.client) {
      await runtime.client.destroy();
      runtime.client = null;
    }
  } catch (_err) {
    runtime.client = null;
  }
  runtime.ready = false;
  runtime.authenticated = false;
  runtime.startRequestedAt = Date.now();
  try {
    await createClientForWorkspace(workspace);
  } finally {
    runtime.recoveryInProgress = false;
  }
}

async function waitForConnected(runtime, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!runtime.client) {
      return false;
    }
    try {
      const state = await runtime.client.getState();
      runtime.lastWaState = state || "";
      if (state === "CONNECTED") {
        return true;
      }
    } catch (_err) {
      // ignore transient errors while reconnecting
    }
    await sleep(1000);
  }
  return false;
}

async function ensureSendableConnection(workspace, runtime) {
  if (!runtime.client) {
    throw new Error("WhatsApp client is not running.");
  }
  if (runtime.ready) {
    return;
  }

  const sendWaitMs = Math.max(15000, Number.parseInt(process.env.WA_SEND_WAIT_MS || "120000", 10) || 120000);
  const restartLimit = Math.max(0, Number.parseInt(process.env.WA_SEND_RESTART_LIMIT || "2", 10) || 2);
  const startedAt = Date.now();
  let restarts = 0;

  while (Date.now() - startedAt < sendWaitMs) {
    if (!runtime.client) {
      break;
    }
    if (runtime.ready) {
      return;
    }

    const connected = await waitForConnected(runtime, 5000);
    if (connected) {
      markWorkspaceReady(workspace, runtime);
      return;
    }

    if (runtime.authenticated && restarts < restartLimit && !runtime.recoveryInProgress) {
      restarts += 1;
      await restartClientBridge(
        workspace,
        runtime,
        `Authenticated but not connected for send attempt. Restarting bridge (${restarts}/${restartLimit}).`
      );
      continue;
    }

    await sleep(1500);
  }

  throw new Error("WhatsApp is authenticated but not connected yet. Keep client running and try send again in a moment.");
}

function startReadyProbe(workspace, runtime) {
  stopReadyProbe(runtime);
  runtime.readyProbeTimer = setInterval(async () => {
    if (!runtime.client || runtime.ready) {
      stopReadyProbe(runtime);
      return;
    }
    try {
      const state = await runtime.client.getState();
      runtime.lastWaState = state || "";
      if (state === "CONNECTED") {
        markWorkspaceReady(workspace, runtime);
        stopReadyProbe(runtime);
      }
    } catch (_err) {
      // Ignore transient getState errors while WA Web finishes bootstrapping.
    }

    // Recovery: if authenticated but never ready for too long, restart client bridge once.
    const waitedMs = runtime.authenticatedAt ? Date.now() - runtime.authenticatedAt : 0;
    if (!runtime.ready && runtime.authenticated && waitedMs > 90000 && !runtime.recoveryAttempted) {
      runtime.recoveryAttempted = true;
      await restartClientBridge(
        workspace,
        runtime,
        "Authenticated but not ready for 90s. Restarting WhatsApp bridge once."
      );
    }
  }, 3000);
}

async function sendBulkMessage(workspace, runtime, messageOrMessages, overrides = {}) {
  if (!runtime.client || (!runtime.ready && !runtime.authenticated)) {
    throw new Error("WhatsApp client is not connected yet.");
  }
  if (runtime.sendInProgress) {
    throw new Error("A campaign is already running for this workspace. Please wait until it finishes.");
  }

  runtime.sendInProgress = true;
  runtime.sendStartedAt = Date.now();

  try {
    await ensureSendableConnection(workspace, runtime);

    const recipients = workspaceRecipientsChatIds(workspace);
    if (recipients.length === 0) {
      throw new Error("No recipients configured.");
    }

    const options = getBulkOptions(workspace.config, overrides);
    const results = [];
    const messages = Array.isArray(messageOrMessages) ? messageOrMessages : [messageOrMessages];

    for (let index = 0; index < recipients.length; index += 1) {
      const chatId = recipients[index];
      const source = sanitizeText(overrides.source, "manual");

      for (const baseMsg of messages) {
        const outgoingMessage = pickMessage(index, baseMsg, options);
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
        // Small delay between sequence messages if there are multiple
        if (messages.length > 1) {
          await sleep(500);
        }
      }

      const interDelayMs = getInterMessageDelay(options);
      if (interDelayMs > 0 && index < recipients.length - 1) {
        await sleep(interDelayMs);
      }
    }

    return results;
  } finally {
    runtime.sendInProgress = false;
    runtime.sendStartedAt = null;
  }
}

function setupScheduler(workspace, runtime) {
  if (runtime.scheduler) {
    runtime.scheduler.stop();
    runtime.scheduler.destroy();
    runtime.scheduler = null;
  }

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

function setupStatusScheduler(workspace, runtime) {
  if (runtime.statusScheduler) {
    runtime.statusScheduler.stop();
    runtime.statusScheduler.destroy();
    runtime.statusScheduler = null;
  }
  if (workspace.config.AI_STATUS_AUTOPILOT_ENABLED !== "true") {
    return;
  }
  const expression = workspace.config.AI_STATUS_AUTOPILOT_CRON || DEFAULT_CONFIG.AI_STATUS_AUTOPILOT_CRON;
  if (!cron.validate(expression)) {
    runtime.lastError = `Invalid AI status cron expression: ${expression}`;
    return;
  }

  runtime.statusScheduler = cron.schedule(expression, async () => {
    try {
      await postLeadSeekingStatus(workspace, runtime, "status_autopilot");
    } catch (err) {
      runtime.lastError = `Auto status failed: ${err.message}`;
      appendReport(workspace, {
        kind: "auto_status",
        source: "status_autopilot",
        ok: false,
        error: err.message,
      });
    }
  });
}

async function createClientForWorkspace(workspace) {
  const runtime = getRuntime(workspace.id);
  if (runtime.client) {
    return;
  }

  clearStaleProfileLocks(workspace.id);

  const headless = workspace.config.HEADLESS !== "false";
  const executablePath = await ensureChromeExecutablePath(runtime);
  const isRender = process.env.RENDER === "true";
  const totalMemMb = Math.floor(os.totalmem() / (1024 * 1024));
  const lowMemoryHost = totalMemMb <= 1200;
  const forceSingleProcess = process.env.CHROME_SINGLE_PROCESS
    ? process.env.CHROME_SINGLE_PROCESS === "true"
    : lowMemoryHost;
  const disableSingleProcess = runtime._disableSingleProcess === true;
  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-software-rasterizer",
    "--disable-gpu-sandbox",
    "--disable-accelerated-2d-canvas",
    "--disable-gpu-shader-disk-cache",
    "--disable-crash-reporter",
    "--disable-features=site-per-process",
    "--disable-gl-drawing-for-tests",
  ];
  const launchTimeoutMs = Math.max(30000, Number.parseInt(process.env.PUPPETEER_LAUNCH_TIMEOUT_MS || "120000", 10) || 120000);
  const authTimeoutMs = Math.max(30000, Number.parseInt(process.env.WA_AUTH_TIMEOUT_MS || "120000", 10) || 120000);

  console.log(`[DEBUG] Attempting to launch client...`);
  console.log(`[DEBUG] CWD: ${process.cwd()}`);
  console.log(`[DEBUG] Executable Path: ${executablePath || "default"}`);
  console.log(`[DEBUG] Environment: ${process.env.NODE_ENV || "unknown"}`);
  console.log(`[DEBUG] Host RAM MB: ${totalMemMb}`);
  const actuallyUsingSingleProcess = !disableSingleProcess && (isRender || forceSingleProcess) && totalMemMb < 2000;
  console.log(`[DEBUG] Single-process mode: ${actuallyUsingSingleProcess ? "on" : "off"}`);
  if (runtime._forceManagedChrome) {
    console.log("[DEBUG] Managed Chrome fallback mode: on");
  }

  if (actuallyUsingSingleProcess) {
    launchArgs.push("--no-zygote", "--single-process");
  } else {
    console.log(
      `[DEBUG] Running without --single-process (RAM ${totalMemMb}MB${disableSingleProcess ? ", crash fallback forced" : ""}).`
    );
  }
  if (process.env.CHROME_DISABLE_SITE_ISOLATION === "true") {
    launchArgs.push("--disable-features=IsolateOrigins,site-per-process");
  }
  runtime.client = new Client({
    authStrategy: new LocalAuth({ clientId: `workspace-${workspace.id}` }),
    authTimeoutMs,
    puppeteer: {
      headless,
      args: launchArgs,
      executablePath: executablePath || undefined,
      timeout: launchTimeoutMs,
      protocolTimeout: launchTimeoutMs,
    },
  });
  console.log(`[DEBUG] Executable being used: ${executablePath || "default (puppeteer)"}`);

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
    console.log(`[${workspace.id}] WhatsApp Client AUTHENTICATED`);
    runtime.authenticated = true;
    runtime.status = "authenticated";
    runtime.authenticatedAt = Date.now();
    runtime.recoveryAttempted = false;
    runtime._retryAfterSharedLibFallback = false;
    runtime._forceSystemChrome = false;
    runtime._forceManagedChrome = false;
    runtime._disableSingleProcess = false;
    runtime._failingChromePaths = [];
    runtime.qrDataUrl = "";
    startReadyProbe(workspace, runtime);
  });

  runtime.client.on("change_state", (state) => {
    runtime.lastWaState = state || "";
    if (state === "CONNECTED") {
      markWorkspaceReady(workspace, runtime);
      stopReadyProbe(runtime);
    }
  });

  runtime.client.on("ready", () => {
    console.log(`[${workspace.id}] WhatsApp Client READY`);
    markWorkspaceReady(workspace, runtime);
    runtime.recoveryAttempted = false;
    runtime._retryAfterSharedLibFallback = false;
    runtime._forceSystemChrome = false;
    runtime._forceManagedChrome = false;
    runtime._disableSingleProcess = false;
    runtime._failingChromePaths = [];
    stopReadyProbe(runtime);
  });

  runtime.client.on("message", async (msg) => {
    console.log(`[SYSTEM] RAW MESSAGE RECEIVED from ${msg.from} in workspace ${workspace.id}`);
    console.log(`[${workspace.id}] Message content: ${msg.body}`);
    const fromId = String(msg.from || "");
    const toId = String(msg.to || "");
    const isStatusMessage =
      msg.isStatus === true ||
      fromId === "status@broadcast" ||
      toId === "status@broadcast" ||
      fromId.endsWith("@broadcast");
    const isChannelMessage = fromId.endsWith("@newsletter");

    if (isStatusMessage || isChannelMessage) {
      console.log(`[${workspace.id}] Ignoring status/channel message from ${fromId || "unknown"}.`);
      return;
    }

    if (workspace.config.AUTO_REPLY_ENABLED !== "true") {
      console.log(`[${workspace.id}] Auto-reply disabled, ignoring message.`);
      return;
    }

    const incomingText = (msg.body || "").trim().toLowerCase();
    const mode = workspace.config.AUTO_REPLY_MODE || DEFAULT_CONFIG.AUTO_REPLY_MODE;
    const trigger = (workspace.config.AUTO_REPLY_TRIGGER || DEFAULT_CONFIG.AUTO_REPLY_TRIGGER).toLowerCase();
    let replyText = "";
    updateLeadStatus(workspace, {
      from: msg.from,
      message: msg.body,
      lastInboundAt: new Date().toISOString(),
      nextFollowUpAt: "",
    });

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

    if (!replyText || workspace.config.AI_SALES_SCOPE === "all") {
      const isGroup = msg.from.endsWith("@g.us");
      const allowAi = workspace.config.AI_SALES_ENABLED === "true" && workspace.config.AI_API_KEY;
      const aiGroups = workspace.config.AI_SALES_GROUPS === "true";

      if (allowAi) {
        if (isGroup && !aiGroups) {
          // Skip AI for groups if disabled
        } else {
          console.log(`[${workspace.id}] AI Sales Closer active. (Server: ${SERVER_STARTED_AT})`);
          try {
            const apiKey = workspace.config.AI_API_KEY;
            const modelName = workspace.config.AI_MODEL || "gemini-1.5-flash";
            const provider = workspace.config.AI_PROVIDER || "google";
            console.log(`[${workspace.id}] Using AI Provider: ${provider}, Model: ${modelName}`);

            const knowledge = (workspace.config.AI_PRODUCT_KNOWLEDGE || "").replace(/^["']|["']$/g, "");
            const bookingEnabled = workspace.config.AI_BOOKING_ENABLED === "true";
            const bookingLink = workspace.config.AI_BOOKING_LINK || "";
            const maxTurns = parseInt(workspace.config.AI_MEMORY_TURNS || "10", 10) || 10;
            const qualificationEnabled = workspace.config.AI_QUALIFICATION_ENABLED !== "false";
            const qualificationFields = parseList(
              workspace.config.AI_QUALIFICATION_FIELDS || DEFAULT_CONFIG.AI_QUALIFICATION_FIELDS
            );
            const closingFlow = sanitizeChoice(
              workspace.config.AI_CLOSING_FLOW,
              ["balanced", "direct", "consultative"],
              DEFAULT_CONFIG.AI_CLOSING_FLOW
            );
            const objectionPlaybook = sanitizeText(workspace.config.AI_OBJECTION_PLAYBOOK, "");
            const includeStatusFeatures = workspace.config.AI_WHATSAPP_STATUS_FEATURES === "true";
            const statusFeaturesText = sanitizeText(
              workspace.config.AI_WHATSAPP_STATUS_FEATURES_TEXT,
              DEFAULT_CONFIG.AI_WHATSAPP_STATUS_FEATURES_TEXT
            );

            await syncConversationHistoryFromChat(workspace, runtime, msg, maxTurns);

            // Fetch contact name to personalize reply
            let contactName = "";
            try {
              const contact = await msg.getContact();
              contactName = contact.pushname || contact.name || contact.number || "";
            } catch (ce) {
              console.log(`[${workspace.id}] Could not get contact name: ${ce.message}`);
            }

            // Load conversation history for this contact
            const history = getConversationHistory(workspace.id, msg.from);
            const historyBlock = formatHistoryForPrompt(history);
            const closingFlowInstruction =
              closingFlow === "direct"
                ? "Use a direct close: summarize value quickly, then ask for a concrete next step."
                : closingFlow === "consultative"
                  ? "Use a consultative close: verify fit, solve objections, and offer a no-pressure next step."
                  : "Use a balanced close: discovery first, value summary, then a clear next action.";

            const prompt = `
          Context: You are a sales assistant for this product: ${knowledge}
          Objective: Answer the lead's question and guide them toward a purchase.
          ${contactName ? `Lead's Name: ${contactName} — Always greet them by name when starting a reply.` : ""}
          ${bookingEnabled && bookingLink ? `Call Booking: If the customer is interested or ready to talk, encourage them to book a call here: ${bookingLink}` : ""}
          ${qualificationEnabled ? `Qualification required: capture these fields when possible: ${qualificationFields.join(", ") || "need, budget, timeline, decision-maker"}.` : ""}
          Closing flow: ${closingFlowInstruction}
          ${includeStatusFeatures && statusFeaturesText ? `Mention this when relevant in offer positioning: ${statusFeaturesText}` : ""}
          ${objectionPlaybook ? `Objection playbook to use when relevant:\n${objectionPlaybook}` : ""}
          ${historyBlock ? `\n${historyBlock}` : ""}
          TASK:
          1. Detect the customer's language and reply in that same language.
          2. Generate a natural, personalized reply (1-3 sentences max). Use the lead's name naturally when appropriate.
          3. If the message is ambiguous, missing key details, or you're unsure, ask ONE clear clarification question instead of guessing.
          4. Keep clarification short, human, and in the customer's language.
          5. Never claim certainty when uncertain.
          6. Evaluate the lead status based on intent (cold, warm, hot) and provide a brief reason.
          7. Include a close question when there is sufficient buying intent.
          8. Keep every output practical and conversion-oriented.
          IMPORTANT: If there is conversation history above, DO NOT repeat greetings or information you already shared. Continue the conversation naturally.

          CURRENT LEAD MESSAGE: "${msg.body}"

          RESPONSE FORMAT (JSON ONLY):
          {
            "reply": "Your response text here",
            "status": "cold" | "warm" | "hot",
            "reason": "Brief explanation of status",
            "language": "detected language name (e.g. English, Hindi, Spanish)",
            "needs_clarification": true | false,
            "clarification_question": "Only required when needs_clarification is true",
            "stage": "new" | "qualified" | "proposal" | "booking" | "closed_won" | "closed_lost",
            "intent_score": 0-100,
            "close_question": "One specific closing question",
            "primary_objection": "Main objection if present, else empty",
            "qualification": {
              "need": "short value",
              "budget": "short value",
              "timeline": "short value",
              "decision_maker": "short value"
            },
            "missing_fields": ["need", "budget", "timeline", "decision_maker"]
          }
        `;

            let normalized = null;
            if (provider === "google") {
              const genAI = new GoogleGenerativeAI(apiKey);
              const model = genAI.getGenerativeModel({ model: modelName });
              console.log(`[${workspace.id}] Google AI Request started...`);
              const result = await model.generateContent(prompt);
              const textResponse = result.response.text().trim();
              console.log(`[${workspace.id}] Google AI Raw Response: ${textResponse}`);

              try {
                const aiData = parseAiJsonResponse(textResponse);
                normalized = normalizeAiDecision(aiData, textResponse);
                const score = scoreLeadDecision({
                  status: normalized.status,
                  qualification: normalized.qualification,
                  needsClarification: normalized.needsClarification,
                  intentScore: normalized.intentScore,
                  incomingText: msg.body,
                });
                replyText = buildSalesReplyFromDecision(normalized, workspace.config, score) || normalized.reply;
                const stage = deriveLeadStage(normalized.stage, score, normalized.status, bookingLink);

                // Save to conversation history (before updating lead, so ordering is clean)
                pushToConversationHistory(workspace.id, msg.from, "user", msg.body, maxTurns);
                pushToConversationHistory(workspace.id, msg.from, "assistant", replyText, maxTurns);

                // Update lead status using pre-fetched contactName
                updateLeadStatus(workspace, {
                  from: msg.from,
                  name: contactName || msg.from,
                  status: normalized.status,
                  reason: normalized.reason,
                  message: msg.body,
                  stage,
                  score,
                  qualification: normalized.qualification,
                  missingQualificationFields: normalized.missingQualificationFields,
                  primaryObjection: normalized.primaryObjection,
                  lastInboundAt: new Date().toISOString(),
                  lastOutboundAt: new Date().toISOString(),
                  followUpCount: 0,
                  nextFollowUpAt: nextFollowUpAt(workspace.config),
                });
                console.log(`[${workspace.id}] Lead status updated for ${contactName || msg.from}`);
              } catch (e) {
                console.error("JSON Parse Error (Google AI):", e.message);
                replyText = textResponse; // Fallback
              }
            } else if (provider === "openrouter") {
              console.log(`[${workspace.id}] OpenRouter AI Request started...`);
              const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                  "HTTP-Referer": "https://restartx.io",
                  "X-Title": "RestartX WhatsApp Console"
                },
                body: JSON.stringify({
                  model: modelName,
                  messages: [
                    { role: "system", content: "You are a sales assistant. IMPORTANT: You MUST respond ONLY with a valid JSON object. No extra text, no markdown, no code blocks. Just the raw JSON." },
                    { role: "user", content: prompt }
                  ]
                })
              });
              const data = await response.json();
              console.log(`[${workspace.id}] OpenRouter AI Raw Response Received`);
              if (data.error) throw new Error(data.error.message || "OpenRouter Error");

              try {
                const rawContent = data?.choices?.[0]?.message?.content || "";
                const aiData = parseAiJsonResponse(rawContent);
                normalized = normalizeAiDecision(aiData, rawContent);
                const score = scoreLeadDecision({
                  status: normalized.status,
                  qualification: normalized.qualification,
                  needsClarification: normalized.needsClarification,
                  intentScore: normalized.intentScore,
                  incomingText: msg.body,
                });
                replyText = buildSalesReplyFromDecision(normalized, workspace.config, score) || normalized.reply;
                const stage = deriveLeadStage(normalized.stage, score, normalized.status, bookingLink);

                // Save to conversation history
                pushToConversationHistory(workspace.id, msg.from, "user", msg.body, maxTurns);
                pushToConversationHistory(workspace.id, msg.from, "assistant", replyText, maxTurns);

                // Update lead status using pre-fetched contactName
                updateLeadStatus(workspace, {
                  from: msg.from,
                  name: contactName || msg.from,
                  status: normalized.status,
                  reason: normalized.reason,
                  message: msg.body,
                  stage,
                  score,
                  qualification: normalized.qualification,
                  missingQualificationFields: normalized.missingQualificationFields,
                  primaryObjection: normalized.primaryObjection,
                  lastInboundAt: new Date().toISOString(),
                  lastOutboundAt: new Date().toISOString(),
                  followUpCount: 0,
                  nextFollowUpAt: nextFollowUpAt(workspace.config),
                });
                console.log(`[${workspace.id}] Lead status updated (OR) for ${contactName || msg.from}`);
              } catch (e) {
                console.error("JSON Parse Error (OpenRouter):", e.message);
                replyText = data.choices[0].message.content.trim();
              }
            }
            console.log(`[${workspace.id}] AI Reply generated: ${replyText}`);
          } catch (err) {
            console.error(`[${workspace.id}] AI Error:`, err.message);
            if (err.message.includes("API_KEY_INVALID")) {
              // You could potentially append a report error here too
            }
          }
        }
      }
    }

    if (replyText) {
      try {
        await msg.reply(replyText);
        updateLeadStatus(workspace, {
          from: msg.from,
          message: msg.body,
          lastOutboundAt: new Date().toISOString(),
          nextFollowUpAt: nextFollowUpAt(workspace.config),
        });
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
    runtime.startRequestedAt = null;
    runtime.qrDataUrl = "";
    runtime.authenticatedAt = null;
    runtime.recoveryAttempted = false;
    runtime.recoveryInProgress = false;
    runtime._retryAfterSharedLibFallback = false;
    runtime._forceSystemChrome = false;
    runtime._forceManagedChrome = false;
    runtime._disableSingleProcess = false;
    runtime._failingChromePaths = [];
    stopReadyProbe(runtime);
    stopScheduler(runtime);
    runtime.client = null;
  });

  runtime.client
    .initialize()
    .catch((err) => {
      const message = String(err?.message || "");
      const isBinaryError = message.includes("error while loading shared libraries") ||
        message.includes("Target.setAutoAttach") ||
        message.includes("Target closed") ||
        message.includes("Protocol error");

      if (isBinaryError && !runtime._retryAfterSharedLibFallback) {
        console.log(`[DEBUG] Triggering stability fallback for workspace ${workspace.id} (Error: ${message})`);

        // Track the failing path so we don't try it again in the fallback attempt
        const failedPath = resolveChromeExecutablePath({
          includeSystem: true,
          preferSystem: true,
          ignoreEnv: runtime._forceSystemChrome || runtime._forceManagedChrome,
        });

        runtime._failingChromePaths = runtime._failingChromePaths || [];
        if (failedPath) {
          runtime._failingChromePaths.push(failedPath);

          // If we just failed with google-chrome, let's aggressively skip the stable variant too
          if (failedPath.includes("google-chrome")) {
            runtime._failingChromePaths.push("/usr/bin/google-chrome");
            runtime._failingChromePaths.push("/usr/bin/google-chrome-stable");
          }
        }
        const configuredEnvPath = String(process.env.PUPPETEER_EXECUTABLE_PATH || "").trim();
        if (configuredEnvPath) {
          runtime._failingChromePaths.push(configuredEnvPath);
          if (configuredEnvPath.includes("chromium-browser")) {
            runtime._failingChromePaths.push("/usr/bin/chromium");
          }
        }

        console.log(`[DEBUG] Wiping stale locks for fallback attempt...`);
        clearStaleProfileLocks(workspace.id);

        runtime._retryAfterSharedLibFallback = true;
        runtime._forceSystemChrome = false;
        runtime._forceManagedChrome = true;
        runtime._disableSingleProcess = true;
        runtime.client = null;
        createClientForWorkspace(workspace).catch((innerErr) => {
          console.error(`[DEBUG] Fallback launch FAILED for workspace ${workspace.id}: ${innerErr.message}`);
          runtime.lastError = `Initialize failed: ${innerErr.message}`;
          runtime.status = "error";
          runtime.ready = false;
          runtime.authenticated = false;
          runtime.startRequestedAt = null;
          runtime.authenticatedAt = null;
          runtime.client = null;
        });
        return;
      }
      runtime._retryAfterSharedLibFallback = false;
      runtime._forceSystemChrome = false;
      runtime._forceManagedChrome = false;
      runtime._disableSingleProcess = false;
      if (message.includes("The browser is already running for") && !runtime._retryAfterLockCleanup) {
        runtime._retryAfterLockCleanup = true;
        clearStaleProfileLocks(workspace.id);
        runtime.client = null;
        createClientForWorkspace(workspace).catch((innerErr) => {
          runtime.lastError = `Initialize failed: ${innerErr.message}`;
          runtime.status = "error";
          runtime.ready = false;
          runtime.authenticated = false;
          runtime.startRequestedAt = null;
          runtime.client = null;
        });
        return;
      }
      runtime._retryAfterLockCleanup = false;
      console.error(`[ERROR] workspace ${workspace.id} initialization failed: ${message}`);
      if (err.stack) console.error(err.stack);

      runtime.lastError = `Initialize failed: ${err.message}`;
      runtime.status = "error";
      runtime.ready = false;
      runtime.authenticated = false;
      runtime.startRequestedAt = null;
      runtime.authenticatedAt = null;
      runtime.recoveryAttempted = false;
      runtime.recoveryInProgress = false;
      stopReadyProbe(runtime);
      runtime.client = null;
    });

  // Probe from the beginning so we can recover even if authenticated/ready events are missed.
  startReadyProbe(workspace, runtime);
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
  runtime.startRequestedAt = null;
  runtime.authenticatedAt = null;
  runtime.recoveryAttempted = false;
  runtime.recoveryInProgress = false;
  runtime.lastWaState = "";
  runtime.sendInProgress = false;
  runtime.sendStartedAt = null;
  runtime._retryAfterSharedLibFallback = false;
  runtime._forceSystemChrome = false;
  runtime._forceManagedChrome = false;
  runtime._disableSingleProcess = false;
  runtime._failingChromePaths = [];
  runtime.historySyncedContacts = new Set();
  stopReadyProbe(runtime);
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
function updateLeadStatus(workspace, leadData) {
  try {
    if (!workspace.leads) workspace.leads = [];
    const contactId = leadData.from;
    let lead = workspace.leads.find((l) => l.id === contactId);

    if (!lead) {
      lead = {
        id: contactId,
        name: leadData.name || contactId.split("@")[0],
        status: "cold",
        reason: "Initial contact",
        stage: "new",
        score: 0,
        lastMessage: "",
        qualification: {
          need: "",
          budget: "",
          timeline: "",
          decision_maker: "",
        },
        missingQualificationFields: ["need", "budget", "timeline", "decision_maker"],
        primaryObjection: "",
        followUpCount: 0,
        nextFollowUpAt: "",
        lastInboundAt: "",
        lastOutboundAt: "",
        updatedAt: new Date().toISOString()
      };
      workspace.leads.push(lead);
    }

    if (leadData.status) lead.status = leadData.status;
    if (leadData.reason) lead.reason = leadData.reason;
    if (leadData.stage) lead.stage = leadData.stage;
    if (Number.isFinite(leadData.score)) lead.score = Math.min(100, Math.max(0, Math.round(leadData.score)));
    if (leadData.message) lead.lastMessage = leadData.message;
    if (leadData.qualification && typeof leadData.qualification === "object") {
      lead.qualification = {
        need: sanitizeText(leadData.qualification.need, lead.qualification?.need || ""),
        budget: sanitizeText(leadData.qualification.budget, lead.qualification?.budget || ""),
        timeline: sanitizeText(leadData.qualification.timeline, lead.qualification?.timeline || ""),
        decision_maker: sanitizeText(
          leadData.qualification.decision_maker,
          lead.qualification?.decision_maker || ""
        ),
      };
    }
    if (Array.isArray(leadData.missingQualificationFields)) {
      lead.missingQualificationFields = leadData.missingQualificationFields
        .map((field) => sanitizeText(field, "").toLowerCase())
        .filter(Boolean);
    }
    if (leadData.primaryObjection !== undefined) {
      lead.primaryObjection = sanitizeText(leadData.primaryObjection, lead.primaryObjection || "");
    }
    if (leadData.lastInboundAt !== undefined) {
      lead.lastInboundAt = sanitizeText(leadData.lastInboundAt, lead.lastInboundAt || "");
    }
    if (leadData.lastOutboundAt !== undefined) {
      lead.lastOutboundAt = sanitizeText(leadData.lastOutboundAt, lead.lastOutboundAt || "");
    }
    if (leadData.nextFollowUpAt !== undefined) {
      lead.nextFollowUpAt = sanitizeText(leadData.nextFollowUpAt, lead.nextFollowUpAt || "");
    }
    if (leadData.followUpCount !== undefined && Number.isFinite(Number(leadData.followUpCount))) {
      lead.followUpCount = Math.max(0, Number.parseInt(String(leadData.followUpCount), 10) || 0);
    }
    lead.updatedAt = new Date().toISOString();

    saveStore();
  } catch (err) {
    console.error(`[ERROR] updateLeadStatus: ${err.message}`);
  }
}

async function processWorkspaceAutoFollowUps(workspace) {
  const config = workspace.config || DEFAULT_CONFIG;
  if (config.AI_FOLLOW_UP_ENABLED !== "true") {
    return false;
  }
  const runtime = getRuntime(workspace.id);
  if (!runtime.client || !runtime.ready) {
    return false;
  }

  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  if (leads.length === 0) {
    return false;
  }

  const maxAttempts = Math.max(1, Number.parseInt(config.AI_FOLLOW_UP_MAX_ATTEMPTS || "3", 10) || 3);
  let changed = false;
  const now = new Date();

  for (const lead of leads) {
    const leadId = String(lead?.id || "");
    if (!leadId) {
      continue;
    }
    if (leadId.endsWith("@g.us") && config.AI_SALES_GROUPS !== "true") {
      continue;
    }
    if ((lead.stage === "closed_won") || (lead.stage === "closed_lost")) {
      continue;
    }
    if ((lead.status || "cold") === "cold") {
      continue;
    }
    const dueAt = new Date(lead.nextFollowUpAt || "");
    if (Number.isNaN(dueAt.getTime()) || dueAt > now) {
      continue;
    }
    const attempts = Number.parseInt(String(lead.followUpCount || 0), 10) || 0;
    if (attempts >= maxAttempts) {
      lead.nextFollowUpAt = "";
      changed = true;
      continue;
    }
    if (lead.lastInboundAt && lead.lastOutboundAt) {
      const inboundAt = new Date(lead.lastInboundAt);
      const outboundAt = new Date(lead.lastOutboundAt);
      if (!Number.isNaN(inboundAt.getTime()) && !Number.isNaN(outboundAt.getTime()) && inboundAt > outboundAt) {
        lead.nextFollowUpAt = "";
        changed = true;
        continue;
      }
    }

    const followUpText = buildFollowUpMessage(workspace, lead);
    if (!followUpText) {
      continue;
    }

    try {
      await runtime.client.sendMessage(leadId, followUpText);
      lead.followUpCount = attempts + 1;
      lead.lastOutboundAt = new Date().toISOString();
      lead.nextFollowUpAt = lead.followUpCount < maxAttempts
        ? nextFollowUpAt(config)
        : "";
      lead.updatedAt = new Date().toISOString();
      appendReport(workspace, {
        kind: "auto_follow_up",
        source: "ai_follow_up",
        ok: true,
        from: leadId,
        message: followUpText,
      });
      changed = true;
    } catch (err) {
      appendReport(workspace, {
        kind: "auto_follow_up",
        source: "ai_follow_up",
        ok: false,
        from: leadId,
        message: followUpText,
        error: err.message,
      });
      runtime.lastError = `Follow-up failed (${leadId}): ${err.message}`;
    }
  }

  return changed;
}

async function processAutoFollowUps() {
  if (followUpSweepInProgress) {
    return;
  }
  followUpSweepInProgress = true;
  try {
    let changed = false;
    for (const workspace of store.workspaces) {
      const updated = await processWorkspaceAutoFollowUps(workspace);
      changed = changed || updated;
    }
    if (changed) {
      saveStore();
    }
  } catch (err) {
    console.error(`[ERROR] processAutoFollowUps: ${err.message}`);
  } finally {
    followUpSweepInProgress = false;
  }
}

function authTokenFromReq(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return "";
  }
  return authHeader.slice("Bearer ".length).trim();
}

function requireAuth(req, res, next) {
  const token = authTokenFromReq(req);
  if (!token) {
    res.status(401).json({ ok: false, error: "Authentication required." });
    return;
  }
  try {
    const payload = jwt.verify(token, AUTH_SECRET);
    const user = getUserById(payload.sub);
    if (!user) {
      res.status(401).json({ ok: false, error: "Invalid token user." });
      return;
    }
    req.user = user;
    next();
  } catch (_err) {
    res.status(401).json({ ok: false, error: "Invalid or expired token." });
  }
}

function requireWorkspace(req, res, minRole = "member") {
  const workspace = getWorkspace(req.params.workspaceId);
  if (!workspace) {
    res.status(404).json({ ok: false, error: "Workspace not found." });
    return null;
  }
  const userId = req.user?.id;
  if (!userId || !hasWorkspaceRole(workspace, userId, minRole)) {
    res.status(403).json({ ok: false, error: "Forbidden for this workspace." });
    return null;
  }
  return workspace;
}

function authPayload(user) {
  const token = jwt.sign({ sub: user.id, username: user.username }, AUTH_SECRET, {
    expiresIn: TOKEN_TTL,
  });
  return {
    token,
    user: safeUser(user),
  };
}

app.post("/api/auth/register", (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    if (!username || username.length < 3) {
      res.status(400).json({ ok: false, error: "Username must be at least 3 chars." });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ ok: false, error: "Password must be at least 6 chars." });
      return;
    }
    if (getUserByUsername(username)) {
      res.status(400).json({ ok: false, error: "Username already exists." });
      return;
    }
    const user = {
      id: `u_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`,
      username,
      passwordHash: bcrypt.hashSync(password, 10),
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
    saveStore();
    res.json({ ok: true, ...authPayload(user) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/auth/login", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");
  const user = getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    res.status(401).json({ ok: false, error: "Invalid username or password." });
    return;
  }
  res.json({ ok: true, ...authPayload(user) });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ ok: true, user: safeUser(req.user) });
});

app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  if (req.path.startsWith("/auth/")) {
    next();
    return;
  }
  requireAuth(req, res, next);
});

app.get("/api/workspaces", (_req, res) => {
  const userId = _req.user.id;
  const allowed = store.workspaces.filter((workspace) => hasWorkspaceRole(workspace, userId, "member"));
  res.json({
    workspaces: allowed.map((workspace) => workspaceSummary(workspace)),
  });
});

app.post("/api/workspaces", (req, res) => {
  try {
    const name = sanitizeText(req.body?.name, "New Workspace");
    let id = toWorkspaceId(req.body?.id || name);
    while (getWorkspace(id)) {
      id = `${id}-${Math.floor(Math.random() * 1000)}`;
    }

    store.workspaces.forEach((ws) => {
      if (!ws.config) ws.config = { ...DEFAULT_CONFIG };
      if (!ws.reports) ws.reports = [];
      if (!ws.members) ws.members = [];
      if (!ws.leads) ws.leads = [];
    });
    saveStore();

    const workspace = {
      id,
      name,
      config: { ...DEFAULT_CONFIG },
      reports: [],
      leads: [],
      members: [{ userId: req.user.id, role: "owner" }],
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
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) {
    return;
  }
  res.json(workspace.config);
});

app.post("/api/workspaces/:workspaceId/config", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) {
    return;
  }

  try {
    workspace.config = sanitizeWorkspaceConfig(req.body || {});
    saveStore();
    const runtime = getRuntime(workspace.id);
    if (runtime.ready) {
      setupScheduler(workspace, runtime);
      setupStatusScheduler(workspace, runtime);
    }

    res.json({ ok: true, config: workspace.config });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/api/workspaces/:workspaceId/leads", requireAuth, async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found" });
    if (!hasWorkspaceRole(workspace, req.user.id, "member")) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    res.json({ ok: true, leads: workspace.leads || [] });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/api/workspaces/:workspaceId/leads/summary", requireAuth, async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found" });
    if (!hasWorkspaceRole(workspace, req.user.id, "member")) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
    const summary = {
      total: leads.length,
      avgScore: 0,
      byStatus: { cold: 0, warm: 0, hot: 0 },
      byStage: {
        new: 0,
        qualified: 0,
        proposal: 0,
        booking: 0,
        closed_won: 0,
        closed_lost: 0,
      },
      actionable: 0,
    };

    let scoreTotal = 0;
    for (const lead of leads) {
      const status = sanitizeChoice(lead.status, ["cold", "warm", "hot"], "cold");
      const stage = sanitizeChoice(
        lead.stage,
        ["new", "qualified", "proposal", "booking", "closed_won", "closed_lost"],
        "new"
      );
      const score = Math.min(100, Math.max(0, Number.parseInt(String(lead.score || 0), 10) || 0));
      summary.byStatus[status] += 1;
      summary.byStage[stage] += 1;
      scoreTotal += score;
      if ((status === "warm" || status === "hot") && stage !== "closed_won" && stage !== "closed_lost") {
        summary.actionable += 1;
      }
    }
    summary.avgScore = leads.length ? Math.round(scoreTotal / leads.length) : 0;

    res.json({ ok: true, summary });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ─── Conversation History API ─────────────────────────────────────────────────
app.get("/api/workspaces/:workspaceId/leads/:contactId/history", requireAuth, async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found" });
    if (!hasWorkspaceRole(workspace, req.user.id, "member")) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    // contactId comes URL-encoded (@ → %40)
    const contactId = decodeURIComponent(req.params.contactId);
    const history = getConversationHistory(req.params.workspaceId, contactId);
    res.json({ ok: true, contactId, history });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ─── Clear Conversation History ───────────────────────────────────────────────
app.delete("/api/workspaces/:workspaceId/leads/:contactId/history", requireAuth, async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: "Workspace not found" });
    if (!hasWorkspaceRole(workspace, req.user.id, "member")) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    const contactId = decodeURIComponent(req.params.contactId);
    const wsMap = conversationHistories.get(req.params.workspaceId);
    if (wsMap) wsMap.delete(contactId);
    res.json({ ok: true, message: "Conversation history cleared." });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/workspaces/:workspaceId/validate-ai-key", async (req, res) => {
  try {
    const { apiKey, model: modelName, provider } = req.body;
    if (!apiKey) {
      return res.status(400).json({ ok: false, error: "API Key is required" });
    }

    const selectedModel = modelName || (provider === "openrouter" ? "google/gemini-2.0-flash-001" : "gemini-1.5-flash");
    const activeProvider = provider || "google";
    console.log(`[SYSTEM] Validating API Key for provider: ${activeProvider}, model: ${selectedModel}`);

    if (activeProvider === "google") {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: selectedModel });
      // Attempt a very small generation to validate the key
      await model.generateContent("hi");
    } else if (activeProvider === "openrouter") {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 5
        })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || "OpenRouter Error");
    }

    res.json({ ok: true, message: "API Key is valid" });
  } catch (err) {
    console.error("API Validation Error:", err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/workspaces/:workspaceId/ai-data-assist", async (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) {
    return;
  }
  try {
    const payload = {
      businessName: sanitizeText(req.body?.businessName, ""),
      offer: sanitizeText(req.body?.offer, ""),
      targetAudience: sanitizeText(req.body?.targetAudience, ""),
      goal: sanitizeText(req.body?.goal, ""),
      tone: sanitizeText(req.body?.tone, "balanced"),
      provider: sanitizeText(req.body?.provider, workspace.config.AI_PROVIDER || "google"),
      model: sanitizeText(req.body?.model, workspace.config.AI_MODEL || DEFAULT_CONFIG.AI_MODEL),
      apiKey: sanitizeText(req.body?.apiKey, workspace.config.AI_API_KEY || ""),
    };
    const generated = await generateAiAssistDraft(payload, workspace.config || DEFAULT_CONFIG);
    res.json({ ok: true, ...generated });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/api/workspaces/:workspaceId/status", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) {
    return;
  }

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

app.get("/api/debug/chrome", (_req, res) => {
  res.json(chromeDebugInfo());
});

app.post("/api/workspaces/:workspaceId/start", async (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) {
    return;
  }

  const runtime = getRuntime(workspace.id);
  if (runtime.client && runtime.ready) {
    res.json({ ok: true, status: runtime.status });
    return;
  }
  if (runtime.status === "starting") {
    res.json({ ok: true, status: runtime.status });
    return;
  }

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

function extractNumbersFromWorkbookBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const numbers = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
    for (const row of rows) {
      if (!Array.isArray(row)) {
        continue;
      }
      for (const cell of row) {
        const onlyDigits = String(cell ?? "").replace(/[^0-9]/g, "");
        if (onlyDigits.length >= 7 && onlyDigits.length <= 15) {
          numbers.push(onlyDigits);
        }
      }
    }
  }
  return numbers;
}

app.post("/api/workspaces/:workspaceId/recipients/import", upload.single("file"), (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) {
    return;
  }

  if (!req.file?.buffer) {
    res.status(400).json({ ok: false, error: "File is required." });
    return;
  }

  try {
    const imported = extractNumbersFromWorkbookBuffer(req.file.buffer);
    const uniqueImported = [...new Set(imported)];
    const mode = req.body?.mode === "replace" ? "replace" : "append";
    const existing = normalizeRecipients(workspace.config.RECIPIENTS || "");
    const finalList =
      mode === "replace" ? uniqueImported : [...new Set([...existing, ...uniqueImported])];

    workspace.config.RECIPIENTS = finalList.join(",");
    saveStore();

    res.json({
      ok: true,
      mode,
      importedCount: uniqueImported.length,
      totalRecipients: finalList.length,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: `Failed to parse file: ${err.message}` });
  }
});

app.post("/api/workspaces/:workspaceId/stop", async (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
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
  const workspace = requireWorkspace(req, res, "admin");
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
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) {
    return;
  }

  try {
    const runtime = getRuntime(workspace.id);
    let messages = [];
    if (Array.isArray(req.body?.messages)) {
      messages = req.body.messages.map(m => sanitizeMultilineText(m, "")).filter(Boolean);
    } else {
      const single = sanitizeMultilineText(req.body?.message, "");
      if (single) messages.push(single);
    }

    if (messages.length === 0) {
      res.status(400).json({ ok: false, error: "At least one message is required." });
      return;
    }

    const results = await sendBulkMessage(workspace, runtime, messages, {
      source: "custom",
      mode: req.body?.mode,
      delayMs: req.body?.delayMs,
      randomMinMs: req.body?.randomMinMs,
      randomMaxMs: req.body?.randomMaxMs,
      templateMode: req.body?.templateMode,
      templateLines: req.body?.templateLines,
    });
    res.json({ ok: true, messages, results });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/workspaces/:workspaceId/status-post-now", async (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) {
    return;
  }
  try {
    const runtime = getRuntime(workspace.id);
    const posted = await postLeadSeekingStatus(workspace, runtime, "status_manual");
    res.json({ ok: true, posted });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/api/workspaces/:workspaceId/reports/summary", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
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
  const workspace = requireWorkspace(req, res, "member");
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
  const workspace = requireWorkspace(req, res, "member");
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

app.get("/api/workspaces/:workspaceId/members", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) {
    return;
  }
  const members = (workspace.members || [])
    .map((member) => {
      const user = getUserById(member.userId);
      if (!user) {
        return null;
      }
      return {
        userId: user.id,
        username: user.username,
        role: member.role,
      };
    })
    .filter(Boolean);
  res.json({ ok: true, members });
});

app.post("/api/workspaces/:workspaceId/members", (req, res) => {
  const workspace = requireWorkspace(req, res, "owner");
  if (!workspace) {
    return;
  }
  const username = normalizeUsername(req.body?.username);
  const role = sanitizeChoice(String(req.body?.role || "member"), ["member", "admin"], "member");
  const user = getUserByUsername(username);
  if (!user) {
    res.status(404).json({ ok: false, error: "User not found." });
    return;
  }
  workspace.members = Array.isArray(workspace.members) ? workspace.members : [];
  const existing = workspace.members.find((member) => member.userId === user.id);
  if (existing) {
    existing.role = role;
  } else {
    workspace.members.push({ userId: user.id, role });
  }
  saveStore();
  res.json({ ok: true });
});

function startHttpServer() {
  try {
    ensureStore();
  } catch (err) {
    console.error(`[FATAL] Failed to initialize data store: ${err.message}`);
    process.exit(1);
  }

  const allowPortFallback = process.env.NODE_ENV !== "production" && process.env.AUTO_PORT_FALLBACK !== "false";
  const maxPortFallbackAttempts = allowPortFallback ? 10 : 0;
  setInterval(() => {
    processAutoFollowUps();
  }, 60 * 1000);

  const listenOn = (port, remainingAttempts) => {
    const server = app.listen(port, HOST, () => {
      console.log(`Web app running at http://${HOST}:${port}`);
      if (port !== PORT) {
        console.log(`[INFO] Preferred port ${PORT} was busy. Using ${port} instead.`);
      }
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && remainingAttempts > 0) {
        const nextPort = port + 1;
        console.error(`[WARN] Port ${port} is already in use. Retrying on ${nextPort}...`);
        listenOn(nextPort, remainingAttempts - 1);
        return;
      }

      if (err.code === "EADDRINUSE") {
        console.error(
          `[FATAL] ${HOST}:${port} is already in use. Stop the conflicting process or set PORT/HOST to a free endpoint.`
        );
      } else if (err.code === "EACCES") {
        console.error(
          `[FATAL] Permission denied for ${HOST}:${port}. Use a non-privileged port (for example 3000).`
        );
      } else {
        console.error(`[FATAL] Server failed to start on ${HOST}:${port}: ${err.message}`);
      }

      process.exit(1);
    });
  };

  listenOn(PORT, maxPortFallbackAttempts);
}

startHttpServer();

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
