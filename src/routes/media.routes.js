/* ─── Media Routes ─────────────────────────────────────────────────────────
 *  Upload, list, delete, storage usage. Enforces plan storage quotas
 *  and file type validation.
 * ─────────────────────────────────────────────────────────────────────────── */

const fs = require("fs");
const path = require("path");
const { Router } = require("express");
const { DATA_DIR } = require("../config/env");
const { requireAuth, requireWorkspace } = require("../middleware/auth");
const upload = require("../middleware/upload");
const { saveStore, getUserById } = require("../models/store");
const { getUserPlan } = require("../services/plan.service");
const {
  isAllowedMimeType,
  getStorageUsedBytes,
  getStorageUsedMB,
  deleteMedia,
  cleanupOrphanMedia,
} = require("../services/media.service");

const router = Router();

// \u2500\u2500\u2500 Storage usage endpoint (must be before /:mediaId to avoid route conflict) ─
router.get("/:workspaceId/media/storage", requireAuth, (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;

  const owner = req.user;
  const plan = owner ? getUserPlan(owner) : { limits: { mediaStorageMB: 10 }, name: "Free" };
  const usedMB = getStorageUsedMB(workspace);
  const limitMB = plan.limits.mediaStorageMB || 10;
  const fileCount = Array.isArray(workspace.media) ? workspace.media.length : 0;

  res.json({
    ok: true,
    storage: {
      usedMB,
      limitMB,
      usedPercent: limitMB > 0 ? Math.min(100, Math.round((usedMB / limitMB) * 100)) : 0,
      fileCount,
      plan: plan.name || "Free",
    },
  });
});

// ─── Cleanup orphan files (admin only, must be before /:mediaId) ──────────
router.post("/:workspaceId/media/cleanup", requireAuth, (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const removed = cleanupOrphanMedia(workspace);
  res.json({ ok: true, orphanFilesRemoved: removed });
});

// ─── Upload with quota + type enforcement ──────────────────────────────────
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

    // ── File type validation ───────────────────────────────────────────
    if (!isAllowedMimeType(req.file.mimetype)) {
      return res.status(400).json({
        ok: false,
        error: `File type "${req.file.mimetype}" is not allowed. Supported: images, audio, video, PDF, Office docs, CSV.`,
      });
    }

    // ── Storage quota enforcement ──────────────────────────────────────
    const owner = req.user; // plan is on the user
    if (owner) {
      const plan = getUserPlan(owner);
      const limitBytes = (plan.limits.mediaStorageMB || 10) * 1024 * 1024;
      const usedBytes = getStorageUsedBytes(workspace);
      const newTotal = usedBytes + req.file.buffer.length;
      if (limitBytes > 0 && newTotal > limitBytes) {
        const usedMB = (usedBytes / (1024 * 1024)).toFixed(1);
        const fileMB = (req.file.buffer.length / (1024 * 1024)).toFixed(1);
        const limitMB = plan.limits.mediaStorageMB;
        return res.status(400).json({
          ok: false,
          error: `Storage limit exceeded. Used ${usedMB} MB + this file ${fileMB} MB > ${limitMB} MB (${plan.name} plan). Delete unused media or upgrade your plan.`,
        });
      }
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
      const fileSizeBytes = req.file.buffer.length;
      const rec = {
        id,
        filename: req.file.originalname || filename,
        path: path.join("media", workspace.id, filename),
        mimeType: req.file.mimetype || "application/octet-stream",
        sizeBytes: fileSizeBytes,
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

// ─── List media ────────────────────────────────────────────────────────────
router.get("/:workspaceId/media", requireAuth, (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json({ ok: true, media: Array.isArray(workspace.media) ? workspace.media : [] });
});

// ─── Delete media (removes file from disk + record from store) ────────────
router.delete("/:workspaceId/media/:mediaId", requireAuth, (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  const removed = deleteMedia(workspace, req.params.mediaId);
  if (!removed) return res.status(404).json({ ok: false, error: "Media not found." });
  res.json({ ok: true, removed });
});

module.exports = router;
