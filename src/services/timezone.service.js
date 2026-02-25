/* ─── Timezone Send Service ─────────────────────────────────────────────────
 *  Detects lead's timezone from phone number prefix and schedules
 *  messages for their optimal sending hours.
 * ─────────────────────────────────────────────────────────────────────────── */

// Country code → approximate UTC offset and optimal send window
const TIMEZONE_MAP = {
  "1":    { tz: "America/New_York",      utcOffset: -5,  optimalStart: 9, optimalEnd: 18 },  // US/Canada
  "44":   { tz: "Europe/London",         utcOffset: 0,   optimalStart: 9, optimalEnd: 18 },  // UK
  "91":   { tz: "Asia/Kolkata",          utcOffset: 5.5, optimalStart: 10, optimalEnd: 19 }, // India
  "971":  { tz: "Asia/Dubai",            utcOffset: 4,   optimalStart: 9, optimalEnd: 18 },  // UAE
  "966":  { tz: "Asia/Riyadh",           utcOffset: 3,   optimalStart: 9, optimalEnd: 18 },  // Saudi
  "49":   { tz: "Europe/Berlin",         utcOffset: 1,   optimalStart: 9, optimalEnd: 18 },  // Germany
  "33":   { tz: "Europe/Paris",          utcOffset: 1,   optimalStart: 9, optimalEnd: 18 },  // France
  "61":   { tz: "Australia/Sydney",      utcOffset: 11,  optimalStart: 9, optimalEnd: 18 },  // Australia
  "81":   { tz: "Asia/Tokyo",            utcOffset: 9,   optimalStart: 9, optimalEnd: 18 },  // Japan
  "86":   { tz: "Asia/Shanghai",         utcOffset: 8,   optimalStart: 9, optimalEnd: 18 },  // China
  "55":   { tz: "America/Sao_Paulo",     utcOffset: -3,  optimalStart: 9, optimalEnd: 18 },  // Brazil
  "52":   { tz: "America/Mexico_City",   utcOffset: -6,  optimalStart: 9, optimalEnd: 18 },  // Mexico
  "234":  { tz: "Africa/Lagos",          utcOffset: 1,   optimalStart: 9, optimalEnd: 18 },  // Nigeria
  "27":   { tz: "Africa/Johannesburg",   utcOffset: 2,   optimalStart: 9, optimalEnd: 18 },  // South Africa
  "62":   { tz: "Asia/Jakarta",          utcOffset: 7,   optimalStart: 9, optimalEnd: 18 },  // Indonesia
  "90":   { tz: "Europe/Istanbul",       utcOffset: 3,   optimalStart: 9, optimalEnd: 18 },  // Turkey
  "7":    { tz: "Europe/Moscow",         utcOffset: 3,   optimalStart: 9, optimalEnd: 18 },  // Russia
  "82":   { tz: "Asia/Seoul",            utcOffset: 9,   optimalStart: 9, optimalEnd: 18 },  // South Korea
  "60":   { tz: "Asia/Kuala_Lumpur",     utcOffset: 8,   optimalStart: 9, optimalEnd: 18 },  // Malaysia
  "65":   { tz: "Asia/Singapore",        utcOffset: 8,   optimalStart: 9, optimalEnd: 18 },  // Singapore
  "20":   { tz: "Africa/Cairo",          utcOffset: 2,   optimalStart: 9, optimalEnd: 18 },  // Egypt
  "92":   { tz: "Asia/Karachi",          utcOffset: 5,   optimalStart: 9, optimalEnd: 18 },  // Pakistan
  "880":  { tz: "Asia/Dhaka",            utcOffset: 6,   optimalStart: 9, optimalEnd: 18 },  // Bangladesh
  "84":   { tz: "Asia/Ho_Chi_Minh",      utcOffset: 7,   optimalStart: 9, optimalEnd: 18 },  // Vietnam
  "63":   { tz: "Asia/Manila",           utcOffset: 8,   optimalStart: 9, optimalEnd: 18 },  // Philippines
  "39":   { tz: "Europe/Rome",           utcOffset: 1,   optimalStart: 9, optimalEnd: 18 },  // Italy
  "34":   { tz: "Europe/Madrid",         utcOffset: 1,   optimalStart: 9, optimalEnd: 18 },  // Spain
};

/**
 * Extract country code from a WhatsApp chat ID (e.g. "971501234567@c.us")
 */
function detectTimezone(chatId) {
  const number = String(chatId || "").replace(/@.*$/, "");
  if (!number) return null;

  // Try longest prefix first (3-digit, then 2-digit, then 1-digit)
  for (const len of [3, 2, 1]) {
    const prefix = number.slice(0, len);
    if (TIMEZONE_MAP[prefix]) return { ...TIMEZONE_MAP[prefix], countryCode: prefix };
  }
  return null;
}

/**
 * Check if it's currently within optimal sending hours for a lead
 */
function isOptimalSendTime(chatId) {
  const tzInfo = detectTimezone(chatId);
  if (!tzInfo) return true; // Unknown timezone, allow send

  const nowUtc = new Date();
  const leadHour = (nowUtc.getUTCHours() + tzInfo.utcOffset + 24) % 24;
  return leadHour >= tzInfo.optimalStart && leadHour < tzInfo.optimalEnd;
}

/**
 * Calculate delay in ms until the next optimal send window
 */
function msUntilOptimalWindow(chatId) {
  const tzInfo = detectTimezone(chatId);
  if (!tzInfo) return 0;

  const nowUtc = new Date();
  const leadHour = (nowUtc.getUTCHours() + tzInfo.utcOffset + 24) % 24;
  const leadMinute = nowUtc.getUTCMinutes();
  const currentMinutes = leadHour * 60 + leadMinute;
  const startMinutes = tzInfo.optimalStart * 60;
  const endMinutes = tzInfo.optimalEnd * 60;

  if (currentMinutes >= startMinutes && currentMinutes < endMinutes) return 0;

  let minutesUntil;
  if (currentMinutes >= endMinutes) {
    // After window, wait until next day's window
    minutesUntil = (24 * 60 - currentMinutes) + startMinutes;
  } else {
    // Before window
    minutesUntil = startMinutes - currentMinutes;
  }
  return minutesUntil * 60 * 1000;
}

module.exports = {
  detectTimezone,
  isOptimalSendTime,
  msUntilOptimalWindow,
  TIMEZONE_MAP,
};
