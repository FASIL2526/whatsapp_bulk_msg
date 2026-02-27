/* ─── Multer upload middleware ──────────────────────────────────────────────
 *  Shared file-upload configuration reused by media & import routes.
 * ─────────────────────────────────────────────────────────────────────────── */

const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },   // 16 MB per-file hard cap; plan quotas enforce total storage
});

module.exports = upload;
