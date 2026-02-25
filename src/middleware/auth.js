/* ─── Authentication Middleware ─────────────────────────────────────────────
 *  JWT-based auth, token extraction, role-guarded workspace access.
 * ─────────────────────────────────────────────────────────────────────────── */

const jwt = require("jsonwebtoken");
const { AUTH_SECRET, TOKEN_TTL } = require("../config/env");
const {
  getUserById,
  getUserByUsername,
  getWorkspace,
  hasWorkspaceRole,
  safeUser,
} = require("../models/store");

function authTokenFromReq(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return "";
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
  return { token, user: safeUser(user) };
}

module.exports = {
  authTokenFromReq,
  requireAuth,
  requireWorkspace,
  authPayload,
};
