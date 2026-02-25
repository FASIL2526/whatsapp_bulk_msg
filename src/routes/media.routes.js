/* ─── Media Routes ─────────────────────────────────────────────────────────*/

const fs = require("fs");
const path = require("path");
const { Router } = require("express");
const { DATA_DIR } = require("../config/env");
const { requireAuth, requireWorkspace } = require("../middleware/auth");
const upload = require("../middleware/upload");
const { saveStore } = require("../models/store");

const router = Router();

router.post(
  "/:workspaceId/media",
  requireAuth,
  upload.single("file"),
  (req, res) => {
    const workspace = requireWorkspace(req, res, "admin");
    if (!workspace) return;
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, error: "File is required." });
    }
    try {
      const mediaDir = path.join(DATA_DIR, "media", workspace.id);
      fs.mkdirSync(mediaDir, { recursive: true });
      const ext = path.extname(req.file.originalname) || "";
      const id = `m_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000)}`;
      const filename = `${id}${ext}`;
      const absPath = path.join(mediaDir, filename);
      fs.writeFileSync(absPath, req.file.buffer);

      workspace.media = Array.isArray(workspace.media) ? workspace.media : [];
      const rec = {
        id,
        filename: req.file.originalname || filename,
        path: path.join("media", workspace.id, filename),
        mimeType: req.file.mimetype || "application/octet-stream",
        uploadedAt: new Date().toISOString(),
      };
      workspace.media.push(rec);
      saveStore();
      res.json({ ok: true, media: rec });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get("/:workspaceId/media", requireAuth, (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({ ok: true, media: Array.isArray(workspace.media) ? workspace.media : [] });
});

module.exports = router;
