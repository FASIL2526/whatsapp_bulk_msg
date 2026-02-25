/* ─── Auto Tag & Segment Service ────────────────────────────────────────────
 *  AI automatically tags leads based on conversation content
 *  (e.g. "price-sensitive", "decision-maker", "tire-kicker").
 * ─────────────────────────────────────────────────────────────────────────── */

const { store, saveStore, appendReport } = require("../models/store");
const { getConversationHistory } = require("./conversation-memory");

const TAG_RULES = [
  {
    tag: "price-sensitive",
    keywords: ["expensive", "cost", "price", "budget", "afford", "cheap", "discount", "deal"],
  },
  {
    tag: "decision-maker",
    keywords: ["i decide", "my decision", "i'm the owner", "ceo", "founder", "i run", "my company", "my business"],
  },
  {
    tag: "tire-kicker",
    keywords: ["just looking", "just browsing", "maybe later", "not sure", "thinking about it", "no rush"],
  },
  {
    tag: "ready-to-buy",
    keywords: ["ready to start", "sign up", "let's do it", "how do i pay", "send invoice", "let's go", "i'm in", "book", "purchase"],
  },
  {
    tag: "referral",
    keywords: ["someone told me", "referred", "friend mentioned", "colleague recommended", "heard about you"],
  },
  {
    tag: "competitor-aware",
    keywords: ["other tool", "competitor", "alternative", "already using", "compared to", "vs", "versus"],
  },
  {
    tag: "urgent",
    keywords: ["asap", "urgent", "right now", "immediately", "today", "this week", "hurry"],
  },
  {
    tag: "enterprise",
    keywords: ["team", "employees", "company-wide", "departments", "enterprise", "organization", "multiple users"],
  },
  {
    tag: "technical",
    keywords: ["api", "integration", "webhook", "sdk", "documentation", "technical", "developer"],
  },
  {
    tag: "returning",
    keywords: ["back again", "used before", "previous", "renewal", "re-subscribe", "come back"],
  },
];

function computeTags(lead, workspaceId) {
  const history = getConversationHistory(workspaceId, lead.id);
  const allUserMessages = history
    .filter((h) => h.role === "user")
    .map((h) => h.content)
    .join(" ")
    .toLowerCase();

  // Also include the last message
  const combinedText = `${allUserMessages} ${(lead.lastMessage || "").toLowerCase()}`;
  if (!combinedText.trim()) return [];

  const tags = [];
  for (const rule of TAG_RULES) {
    const matched = rule.keywords.some((kw) => combinedText.includes(kw));
    if (matched) tags.push(rule.tag);
  }

  // Score-based tags
  const score = lead.score || 0;
  if (score >= 80) tags.push("high-intent");
  if (score <= 20 && lead.status === "cold") tags.push("low-intent");

  // Stage-based tags
  if (lead.stage === "booking") tags.push("booking-stage");
  if (lead.stage === "proposal") tags.push("proposal-stage");

  return [...new Set(tags)];
}

async function processWorkspaceTagging(workspace) {
  if (workspace.config?.AUTO_TAGGING_ENABLED !== "true") return false;

  const leads = Array.isArray(workspace.leads) ? workspace.leads : [];
  let changed = false;

  for (const lead of leads) {
    if (!lead.id) continue;
    if (lead.archived) continue;

    const newTags = computeTags(lead, workspace.id);
    const currentTags = Array.isArray(lead.tags) ? lead.tags : [];

    // Merge new tags with existing (don't remove manual tags)
    const merged = [...new Set([...currentTags, ...newTags])];
    if (JSON.stringify(merged.sort()) !== JSON.stringify(currentTags.sort())) {
      lead.tags = merged;
      lead.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  return changed;
}

async function processAutoTagging() {
  try {
    let changed = false;
    for (const ws of store.workspaces) {
      const updated = await processWorkspaceTagging(ws);
      changed = changed || updated;
    }
    if (changed) saveStore();
  } catch (err) {
    console.error(`[ERROR] processAutoTagging: ${err.message}`);
  }
}

module.exports = { processAutoTagging, processWorkspaceTagging, computeTags, TAG_RULES };
