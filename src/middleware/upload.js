/* ─── Multer upload middleware ──────────────────────────────────────────────
 *  Shared file-upload configuration reused by media & import routes.
 * ─────────────────────────────────────────────────────────────────────────── */

const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

module.exports = upload;
