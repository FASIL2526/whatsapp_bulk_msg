/* ─── AI Service ───────────────────────────────────────────────────────────
 *  AI response parsing, lead scoring, decision normalisation,
 *  sales-reply building, AI-assist draft generation,
 *  and WhatsApp status content generation & posting.
 * ─────────────────────────────────────────────────────────────────────────── */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { DEFAULT_CONFIG } = require("../config/default-config");
const {
  sanitizeText,
  sanitizeMultilineText,
  sanitizeChoice,
} = require("../utils/workspace-config");
const { appendReport } = require("../models/store");
const { fetchWithRetry } = require("../utils/helpers");

// ─── JSON parsing ──────────────────────────────────────────────────────────
function parseAiJsonResponse(rawText) {
  const text = String(rawText || "").trim();
  if (!text) throw new Error("Empty AI response");
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
  const needsClarification =
    String(data.needs_clarification || "").trim().toLowerCase() === "true" ||
    data.needs_clarification === true;
  const clarificationQuestion = sanitizeText(data.clarification_question, "");
  const closeQuestion = sanitizeText(data.close_question, "");
  const primaryObjection = sanitizeText(data.primary_objection, "");
  const intentScore = Math.min(
    100,
    Math.max(0, Number.parseInt(String(data.intent_score ?? ""), 10) || 0)
  );
  const qualification =
    data.qualification && typeof data.qualification === "object"
      ? {
          need: sanitizeText(data.qualification.need, ""),
          budget: sanitizeText(data.qualification.budget, ""),
          timeline: sanitizeText(data.qualification.timeline, ""),
          decision_maker: sanitizeText(data.qualification.decision_maker, ""),
        }
      : { need: "", budget: "", timeline: "", decision_maker: "" };
  const missingQualificationFields = Array.isArray(data.missing_fields)
    ? data.missing_fields.map((f) => sanitizeText(f, "").toLowerCase()).filter(Boolean)
    : [];
  const finalReply = needsClarification
    ? clarificationQuestion || reply || "Could you clarify what you need so I can help you better?"
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

// ─── Lead scoring ──────────────────────────────────────────────────────────
function qualificationCompletion(qualification) {
  const q = qualification || {};
  const fields = ["need", "budget", "timeline", "decision_maker"];
  const complete = fields.filter((f) => String(q[f] || "").trim().length > 0).length;
  return { complete, total: fields.length, ratio: complete / fields.length };
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
  if (input.needsClarification) score -= 8;
  if (Number.isFinite(input.intentScore) && input.intentScore > 0) {
    score = Math.round(score * 0.5 + input.intentScore * 0.5);
  }
  return Math.min(100, Math.max(0, score));
}

function deriveLeadStage(currentStage, score, status, bookingLink) {
  const explicit = sanitizeChoice(
    sanitizeText(currentStage, ""),
    ["new", "qualified", "proposal", "booking", "closed_won", "closed_lost"],
    ""
  );
  if (explicit) return explicit;
  if (status === "hot" && score >= 85) return bookingLink ? "booking" : "proposal";
  if (status === "hot" || score >= 65) return "proposal";
  if (status === "warm" || score >= 45) return "qualified";
  return "new";
}

// ─── Close-question & sales reply ──────────────────────────────────────────
function shouldAskCloseQuestion(config, status, score, needsClarification) {
  if (needsClarification) return false;
  const mode = sanitizeChoice(
    sanitizeText(config.AI_CLOSE_QUESTION_MODE, DEFAULT_CONFIG.AI_CLOSE_QUESTION_MODE),
    ["off", "hot_only", "warm_hot", "always"],
    DEFAULT_CONFIG.AI_CLOSE_QUESTION_MODE
  );
  if (mode === "off") return false;
  if (mode === "always") return true;
  if (mode === "hot_only") return status === "hot" || score >= 75;
  return status === "warm" || status === "hot" || score >= 55;
}

function buildSalesReplyFromDecision(normalized, config, score) {
  let reply = String(normalized.reply || "").trim();
  if (!reply) return "";
  const shouldClose = shouldAskCloseQuestion(config, normalized.status, score, normalized.needsClarification);
  if (!shouldClose) return reply;
  const closeQuestion = sanitizeText(normalized.closeQuestion, "");
  if (!closeQuestion) return reply;

  if (config.AI_AUTO_STORY_TO_CLOSE === "true") {
    const story = sanitizeText(config.AI_CLOSING_STORY, "");
    if (story) reply = `${reply} ${story}`;
  }
  if (config.AI_WHATSAPP_STATUS_FEATURES === "true") {
    const statusFeaturesText = sanitizeText(
      config.AI_WHATSAPP_STATUS_FEATURES_TEXT,
      DEFAULT_CONFIG.AI_WHATSAPP_STATUS_FEATURES_TEXT
    );
    if (statusFeaturesText) reply = `${reply} ${statusFeaturesText}`;
  }
  return `${reply} ${closeQuestion}`.replace(/\s+/g, " ").trim();
}

// ─── AI-Assist draft generator ─────────────────────────────────────────────
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
    statusFeaturesText:
      "We also use WhatsApp Status features to publish updates/offers and bring in additional inbound conversations.",
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
  const modelName = sanitizeText(
    payload.model || workspaceConfig.AI_MODEL,
    DEFAULT_CONFIG.AI_MODEL
  );
  const apiKey = sanitizeText(payload.apiKey || workspaceConfig.AI_API_KEY, "");
  if (!apiKey) return { draft: baseDraft, source: "local_fallback_no_key" };

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
    let raw = "";
    if (provider === "google") {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      raw = result.response.text().trim();
    } else {
      const response = await fetchWithRetry("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: "You are a sales-ops assistant. Return only JSON." },
            { role: "user", content: prompt },
          ],
        }),
      }, { retries: 2, timeoutMs: 30000, label: "ai-assist" });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || "OpenRouter error");
      raw = data?.choices?.[0]?.message?.content || "";
    }

    const parsed = parseAiJsonResponse(raw);
    return {
      source: provider === "google" ? "ai_google" : "ai_openrouter",
      draft: {
        ...baseDraft,
        productKnowledge: sanitizeMultilineText(parsed.productKnowledge, baseDraft.productKnowledge),
        closingStory: sanitizeText(parsed.closingStory, baseDraft.closingStory),
        objectionPlaybook: sanitizeMultilineText(parsed.objectionPlaybook, baseDraft.objectionPlaybook),
        followUpTemplate: sanitizeText(parsed.followUpTemplate, baseDraft.followUpTemplate),
        statusFeaturesText: sanitizeText(parsed.statusFeaturesText, baseDraft.statusFeaturesText),
        qualificationFields: sanitizeText(parsed.qualificationFields, baseDraft.qualificationFields),
        closingFlow: sanitizeChoice(
          parsed.closingFlow,
          ["balanced", "direct", "consultative"],
          baseDraft.closingFlow
        ),
        closeQuestionMode: sanitizeChoice(
          parsed.closeQuestionMode,
          ["off", "hot_only", "warm_hot", "always"],
          baseDraft.closeQuestionMode
        ),
        autoStoryToClose: sanitizeChoice(
          parsed.autoStoryToClose,
          ["true", "false"],
          baseDraft.autoStoryToClose
        ),
        whatsappStatusFeatures: sanitizeChoice(
          parsed.whatsappStatusFeatures,
          ["true", "false"],
          baseDraft.whatsappStatusFeatures
        ),
        followUpEnabled: sanitizeChoice(
          parsed.followUpEnabled,
          ["true", "false"],
          baseDraft.followUpEnabled
        ),
      },
    };
  } catch (err) {
    return { source: "local_fallback_error", warning: err.message, draft: baseDraft };
  }
}

// ─── WhatsApp Status content generation ────────────────────────────────────
function localLeadSeekingStatusText(workspace) {
  const cfg = workspace.config || DEFAULT_CONFIG;
  const tone = sanitizeChoice(
    sanitizeText(cfg.AI_STATUS_AUTOPILOT_TONE, DEFAULT_CONFIG.AI_STATUS_AUTOPILOT_TONE),
    ["direct", "friendly", "consultative"],
    DEFAULT_CONFIG.AI_STATUS_AUTOPILOT_TONE
  );
  const cta = sanitizeText(cfg.AI_STATUS_AUTOPILOT_CTA, DEFAULT_CONFIG.AI_STATUS_AUTOPILOT_CTA);
  const knowledgeRaw = sanitizeText(cfg.AI_PRODUCT_KNOWLEDGE, DEFAULT_CONFIG.AI_PRODUCT_KNOWLEDGE);
  const knowledgeSentence =
    knowledgeRaw
      .split(/[.!?]/)
      .map((s) => s.trim())
      .filter(Boolean)[0] || knowledgeRaw;

  if (tone === "friendly")
    return `Helping businesses grow with smarter WhatsApp outreach. ${knowledgeSentence}. ${cta}`;
  if (tone === "consultative")
    return `If you're evaluating better WhatsApp lead handling, here's what we solve: ${knowledgeSentence}. ${cta}`;
  return `Need more qualified leads from WhatsApp? ${knowledgeSentence}. ${cta}`;
}

async function generateLeadSeekingStatusContent(workspace) {
  const cfg = workspace.config || DEFAULT_CONFIG;
  const useAi = cfg.AI_STATUS_AUTOPILOT_USE_AI !== "false";
  const apiKey = sanitizeText(cfg.AI_API_KEY, "");
  const provider = sanitizeChoice(cfg.AI_PROVIDER, ["google", "openrouter"], "google");
  const modelName = sanitizeText(cfg.AI_MODEL, DEFAULT_CONFIG.AI_MODEL);
  const fallback = localLeadSeekingStatusText(workspace);

  if (!useAi || !apiKey) return { text: fallback, source: "status_local" };

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
    let raw = "";
    if (provider === "google") {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      raw = result.response.text().trim();
    } else {
      const response = await fetchWithRetry("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: "Return JSON only." },
            { role: "user", content: prompt },
          ],
        }),
      }, { retries: 2, timeoutMs: 30000, label: "status-gen" });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || "OpenRouter status generation error");
      raw = data?.choices?.[0]?.message?.content || "";
    }

    const parsed = parseAiJsonResponse(raw);
    return {
      text: sanitizeText(parsed.status_text, fallback),
      source: provider === "google" ? "status_ai_google" : "status_ai_openrouter",
    };
  } catch (err) {
    return { text: fallback, source: "status_local_fallback", warning: err.message };
  }
}

async function postLeadSeekingStatus(workspace, runtime, triggerSource = "status_autopilot") {
  if (!runtime.client || (!runtime.ready && !runtime.authenticated)) {
    throw new Error("WhatsApp client is not connected yet.");
  }
  const generated = await generateLeadSeekingStatusContent(workspace);
  const text = sanitizeText(generated.text, "");
  if (!text) throw new Error("Generated status text is empty.");

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

module.exports = {
  parseAiJsonResponse,
  normalizeAiDecision,
  qualificationCompletion,
  scoreLeadDecision,
  deriveLeadStage,
  shouldAskCloseQuestion,
  buildSalesReplyFromDecision,
  buildLocalAiAssistDraft,
  generateAiAssistDraft,
  localLeadSeekingStatusText,
  generateLeadSeekingStatusContent,
  postLeadSeekingStatus,
};
