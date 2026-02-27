/* ─── Branding Service ─────────────────────────────────────────────────────
 *  White-label / custom branding per workspace.
 *  Enterprise customers can set their own logo, name, colors.
 * ─────────────────────────────────────────────────────────────────────────── */

const { saveStore } = require("../models/store");
const { sanitizeText } = require("../utils/workspace-config");

const DEFAULT_BRANDING = {
  appName: "RestartX",
  logoUrl: "",
  faviconUrl: "",
  primaryColor: "#6366f1",
  accentColor: "#f59e0b",
  supportEmail: "",
  supportUrl: "",
  customCss: "",
  footerText: "",
  loginMessage: "",
};

function ensureBranding(workspace) {
  if (!workspace.branding || typeof workspace.branding !== "object") {
    workspace.branding = { ...DEFAULT_BRANDING };
  }
}

/** Get branding for a workspace */
function getBranding(workspace) {
  ensureBranding(workspace);
  return { ...DEFAULT_BRANDING, ...workspace.branding };
}

/** Update branding */
function updateBranding(workspace, updates) {
  ensureBranding(workspace);
  const allowed = Object.keys(DEFAULT_BRANDING);
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      workspace.branding[key] = sanitizeText(updates[key], workspace.branding[key] || DEFAULT_BRANDING[key]);
    }
  }
  saveStore();
  return getBranding(workspace);
}

/** Reset branding to defaults */
function resetBranding(workspace) {
  workspace.branding = { ...DEFAULT_BRANDING };
  saveStore();
  return workspace.branding;
}

module.exports = {
  DEFAULT_BRANDING,
  ensureBranding,
  getBranding,
  updateBranding,
  resetBranding,
};
