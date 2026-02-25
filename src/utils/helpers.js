/* ─── Generic utility functions ────────────────────────────────────────────
 *  Pure helpers with no internal project dependencies.
 * ─────────────────────────────────────────────────────────────────────────── */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseList(raw) {
  return String(raw || "")
    .split(/[,\n]/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function toCsv(rows) {
  const esc = (value) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  return rows.map((row) => row.map((value) => esc(value)).join(",")).join("\n");
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

function parseTimeParts(raw, fallbackHour, fallbackMinute) {
  const match = String(raw || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return { hour: fallbackHour, minute: fallbackMinute };
  }
  const hour = Math.min(23, Math.max(0, Number.parseInt(match[1], 10) || fallbackHour));
  const minute = Math.min(59, Math.max(0, Number.parseInt(match[2], 10) || fallbackMinute));
  return { hour, minute };
}

/**
 * Fetch wrapper with timeout + automatic retry for transient network errors.
 * @param {string} url
 * @param {RequestInit} opts
 * @param {{ retries?: number, timeoutMs?: number, label?: string }} extra
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, opts = {}, { retries = 2, timeoutMs = 30000, label = "fetch" } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const cause = err.cause ? ` cause=${err.cause.code || err.cause.message || err.cause}` : "";
      const isLast = attempt > retries;
      console.warn(
        `[${label}] fetch attempt ${attempt}/${retries + 1} failed: ${err.message}${cause}${isLast ? " — giving up" : " — retrying in 1s"}`
      );
      if (!isLast) await sleep(1000);
    }
  }
  throw lastErr;
}

module.exports = {
  sleep,
  parseList,
  toCsv,
  parseTemplateLines,
  parseAutoReplyRules,
  parseIsoInput,
  parseTimeParts,
  fetchWithRetry,
};
