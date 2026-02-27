/* ─── Email Notification Service ────────────────────────────────────────────
 *  Send email alerts via SMTP or HTTP API (Mailgun, SendGrid, etc.).
 *  Falls back to console logging if no email config is set.
 * ─────────────────────────────────────────────────────────────────────────── */

const { sanitizeText } = require("../utils/workspace-config");

/** Send email notification */
async function sendEmailNotification({ to, subject, body, workspace }) {
  const smtpUrl = sanitizeText(process.env.EMAIL_WEBHOOK_URL, "");
  const fromEmail = sanitizeText(process.env.EMAIL_FROM, "noreply@restartx.io");

  if (!to) {
    console.log("[EMAIL] ⚠️ No recipient, skipping.");
    return { ok: false, error: "No recipient" };
  }

  // ── Method 1: HTTP webhook (Zapier, Make, custom API) ──
  if (smtpUrl) {
    try {
      const resp = await fetch(smtpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          from: fromEmail,
          subject,
          body,
          html: body,
          workspace: workspace?.id || "",
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      console.log(`[EMAIL] ✅ Sent to ${to}: "${subject}"`);
      return { ok: true, method: "webhook" };
    } catch (err) {
      console.error(`[EMAIL] ❌ Webhook failed: ${err.message}`);
      return { ok: false, method: "webhook", error: err.message };
    }
  }

  // ── Fallback: console log (no email config) ──
  console.log(`[EMAIL] 📧 (not configured) Would send to: ${to}`);
  console.log(`[EMAIL]   Subject: ${subject}`);
  console.log(`[EMAIL]   Body: ${body?.substring(0, 200)}...`);
  return { ok: false, method: "none", error: "Email not configured. Set EMAIL_WEBHOOK_URL env var." };
}

/** Send digest/report email */
async function sendDigestEmail(workspace, { to, leads, reports }) {
  const totalLeads = (leads || []).length;
  const hotLeads = (leads || []).filter(l => l.status === "hot").length;
  const newToday = (leads || []).filter(l => {
    const d = new Date(l.updatedAt || "");
    const today = new Date();
    return d.toDateString() === today.toDateString();
  }).length;
  const totalMessages = (reports || []).length;

  const subject = `[RestartX] Daily Digest — ${workspace.name}`;
  const body = `
    <h2>📊 Daily Digest: ${workspace.name}</h2>
    <table style="border-collapse:collapse;font-family:sans-serif;">
      <tr><td style="padding:8px;border:1px solid #ddd;"><strong>Total Leads</strong></td><td style="padding:8px;border:1px solid #ddd;">${totalLeads}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;"><strong>Hot Leads</strong></td><td style="padding:8px;border:1px solid #ddd;">${hotLeads}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;"><strong>Active Today</strong></td><td style="padding:8px;border:1px solid #ddd;">${newToday}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;"><strong>Messages (24h)</strong></td><td style="padding:8px;border:1px solid #ddd;">${totalMessages}</td></tr>
    </table>
    <p style="color:#888;font-size:12px;margin-top:16px;">Generated at ${new Date().toISOString()}</p>
  `;

  return sendEmailNotification({ to, subject, body, workspace });
}

/** Send alert email for a specific event */
async function sendAlertEmail(workspace, { to, event, data }) {
  const subject = `[RestartX Alert] ${event} — ${workspace.name}`;
  const body = `
    <h3>⚡ Alert: ${event}</h3>
    <p><strong>Workspace:</strong> ${workspace.name}</p>
    <pre style="background:#f5f5f5;padding:12px;border-radius:4px;font-size:13px;">${JSON.stringify(data, null, 2)}</pre>
    <p style="color:#888;font-size:12px;">Triggered at ${new Date().toISOString()}</p>
  `;

  return sendEmailNotification({ to, subject, body, workspace });
}

module.exports = {
  sendEmailNotification,
  sendDigestEmail,
  sendAlertEmail,
};
