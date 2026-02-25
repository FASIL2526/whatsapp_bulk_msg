/* ─── Media Service ────────────────────────────────────────────────────────
 *  Media path resolution.
 * ─────────────────────────────────────────────────────────────────────────── */

const path = require("path");
const { DATA_DIR } = require("../config/env");

function resolveMediaPath(workspace, mediaId) {
  const mediaRec = (workspace.media || []).find((m) => m.id === String(mediaId));
  if (!mediaRec || !mediaRec.path) return null;
  const absPath = path.isAbsolute(mediaRec.path)
    ? mediaRec.path
    : path.join(DATA_DIR, mediaRec.path);
  return { ...mediaRec, absPath };
}

module.exports = { resolveMediaPath };
