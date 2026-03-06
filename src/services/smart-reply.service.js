/* ─── Smart Reply Suggestions Service ──────────────────────────────────────
 *  During human takeover, generates 3 AI-powered reply suggestions
 *  based on conversation context, lead data, and product knowledge.
 * ─────────────────────────────────────────────────────────────────────────── */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { DEFAULT_CONFIG } = require("../config/default-config");
const { sanitizeText } = require("../utils/workspace-config");

async function generateSmartReplies(workspace, contactId) {
  const cfg = workspace.config || {};
  const provider = cfg.AI_PROVIDER || "google";
  const apiKey = cfg.AI_API_KEY || "";
  const modelName = cfg.AI_MODEL || "gemini-1.5-flash";

  if (!apiKey && provider !== "ollama") {
    return { suggestions: [], error: "AI not configured" };
  }

  // Gather chat context from livechat buffer
  const livechat = workspace._liveChat || {};
  const messages = livechat[contactId] || [];
  if (messages.length === 0) {
    return { suggestions: getDefaultSuggestions(), error: null };
  }

  // Get lead data
  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  const lead = leads.find(l => l.id === contactId);
  const leadContext = lead
    ? `Lead: ${lead.name || "Unknown"}, Status: ${lead.status || "unknown"}, Stage: ${lead.stage || "new"}, Score: ${lead.score || 0}`
    : "";

  // Get product knowledge
  const knowledge = (cfg.AI_PRODUCT_KNOWLEDGE || "").replace(/^["']|["']$/g, "");

  // Build recent messages context (last 10)
  const recent = messages.slice(-10);
  const chatHistory = recent
    .map(m => `${m.dir === "in" ? "Customer" : "Agent"}: ${m.text}`)
    .join("\n");

  const prompt = `You are an AI assistant helping a human sales agent who is chatting with a customer on WhatsApp.

${knowledge ? `Product/Business Info: ${knowledge}` : ""}
${leadContext ? `\n${leadContext}` : ""}

Recent conversation:
${chatHistory}

Generate exactly 3 short, natural reply suggestions the human agent could send next.
Each suggestion should be:
- 1-2 sentences max
- Different in tone: one helpful/informative, one closing/action-oriented, one empathetic/rapport-building
- In the same language as the customer's messages
- Contextually relevant to the conversation

RESPONSE FORMAT (JSON ONLY, no markdown):
{
  "suggestions": [
    {"text": "reply text here", "type": "informative"},
    {"text": "reply text here", "type": "closing"},
    {"text": "reply text here", "type": "empathetic"}
  ]
}`;

  try {
    let rawContent = "";

    if (provider === "google") {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      rawContent = result.response.text().trim();
    } else if (provider === "ollama") {
      const ollamaBase = sanitizeText(
        cfg.OLLAMA_BASE_URL,
        DEFAULT_CONFIG.OLLAMA_BASE_URL || "http://localhost:11434"
      ).replace(/\/+$/, "");
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const resp = await fetch(`${ollamaBase}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: modelName,
          stream: false,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!resp.ok) throw new Error(`Ollama error: ${resp.status}`);
      const data = await resp.json();
      rawContent = data?.message?.content || "";
    } else {
      // OpenRouter
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!resp.ok) throw new Error(`OpenRouter error: ${resp.status}`);
      const data = await resp.json();
      rawContent = data.choices?.[0]?.message?.content || "";
    }

    // Parse JSON from response
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0) {
        return {
          suggestions: parsed.suggestions.slice(0, 3).map(s => ({
            text: String(s.text || ""),
            type: String(s.type || "general"),
          })),
          error: null,
        };
      }
    }

    return { suggestions: getDefaultSuggestions(), error: "Could not parse AI response" };
  } catch (err) {
    console.error("[SmartReply] Error:", err.message);
    return { suggestions: getDefaultSuggestions(), error: err.message };
  }
}

function getDefaultSuggestions() {
  return [
    { text: "Thanks for reaching out! How can I help you today?", type: "informative" },
    { text: "Would you like to schedule a call to discuss this further?", type: "closing" },
    { text: "I completely understand your concern. Let me look into that for you.", type: "empathetic" },
  ];
}

module.exports = {
  generateSmartReplies,
};
