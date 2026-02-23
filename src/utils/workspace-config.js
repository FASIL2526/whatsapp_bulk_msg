const cron = require("node-cron");
const { DEFAULT_CONFIG } = require("../config/default-config");

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
    AI_SALES_ENABLED: input.AI_SALES_ENABLED === "true" ? "true" : "false",
    AI_PROVIDER: input.AI_PROVIDER === "openrouter" ? "openrouter" : "google",
    AI_MODEL: sanitizeText(input.AI_MODEL, DEFAULT_CONFIG.AI_MODEL),
    AI_SALES_SCOPE: input.AI_SALES_SCOPE === "all" ? "all" : "not_matched",
    AI_SALES_GROUPS: input.AI_SALES_GROUPS === "true" ? "true" : "false",
    AI_BOOKING_ENABLED: input.AI_BOOKING_ENABLED === "true" ? "true" : "false",
    AI_BOOKING_LINK: sanitizeText(input.AI_BOOKING_LINK, DEFAULT_CONFIG.AI_BOOKING_LINK),
    AI_API_KEY: sanitizeText(input.AI_API_KEY, DEFAULT_CONFIG.AI_API_KEY),
    AI_PRODUCT_KNOWLEDGE: sanitizeMultilineText(input.AI_PRODUCT_KNOWLEDGE, DEFAULT_CONFIG.AI_PRODUCT_KNOWLEDGE),
    AI_MEMORY_TURNS: String(Math.min(20, Math.max(1, parseInt(input.AI_MEMORY_TURNS, 10) || 10))),
  };

  if (Number(clean.BULK_RANDOM_MAX_MS) < Number(clean.BULK_RANDOM_MIN_MS)) {
    clean.BULK_RANDOM_MAX_MS = clean.BULK_RANDOM_MIN_MS;
  }

  if (!cron.validate(clean.SCHEDULE_CRON)) {
    throw new Error("Invalid cron expression.");
  }

  return clean;
}

module.exports = {
  normalizeRecipients,
  sanitizeText,
  sanitizeMultilineText,
  sanitizeChoice,
  sanitizeIntegerString,
  sanitizeWorkspaceConfig,
};
