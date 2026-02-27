/* ─── Media Service ────────────────────────────────────────────────────────
 *  Media path resolution, storage tracking, cleanup, and validation.
 * ─────────────────────────────────────────────────────────────────────────── */

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../config/env");
const { saveStore } = require("../models/store");

// ─── Allowed MIME types (safe for WhatsApp) ────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg", "image/png", "image/gif", "image/webp",
  // Audio
  "audio/mpeg", "audio/ogg", "audio/wav", "audio/aac", "audio/mp4",
  // Video
  "video/mp4", "video/3gpp", "video/quicktime",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
]);

function isAllowedMimeType(mimeType) {
  return ALLOWED_MIME_TYPES.has(String(mimeType || "").toLowerCase());
}

// ─── Path resolution ───────────────────────────────────────────────────────
function resolveMediaPath(workspace, mediaId) {
  const mediaRec = (workspace.media || []).find((m) => m.id === String(mediaId));
  if (!mediaRec || !mediaRec.path) return null;
  const absPath = path.isAbsolute(mediaRec.path)
    ? mediaRec.path
    : path.join(DATA_DIR, mediaRec.path);
  return { ...mediaRec, absPath };
}

// ─── Storage calculation ───────────────────────────────────────────────────

/**
 * Calculate total bytes used by a workspace's media files on disk.
 */
function getStorageUsedBytes(workspace) {
  const media = Array.isArray(workspace.media) ? workspace.media : [];
  let totalBytes = 0;
  for (const rec of media) {
    const absPath = path.isAbsolute(rec.path)
      ? rec.path
      : path.join(DATA_DIR, rec.path);
    try {
      const stat = fs.statSync(absPath);
      totalBytes += stat.size;
    } catch (_) {
      // file missing on disk, skip
    }
  }
  return totalBytes;
}

function getStorageUsedMB(workspace) {
  return Number((getStorageUsedBytes(workspace) / (1024 * 1024)).toFixed(2));
}

// ─── Delete a media file ───────────────────────────────────────────────────

/**
 * Remove a media record and its file from disk.
 * Returns the removed record or null.
 */
function deleteMedia(workspace, mediaId) {
  if (!Array.isArray(workspace.media)) return null;
  const idx = workspace.media.findIndex((m) => m.id === String(mediaId));
  if (idx === -1) return null;

  const rec = workspace.media[idx];
  // Remove file from disk
  const absPath = path.isAbsolute(rec.path)
    ? rec.path
    : path.join(DATA_DIR, rec.path);
  try { fs.unlinkSync(absPath); } catch (_) { /* already gone */ }

  // Remove record
  workspace.media.splice(idx, 1);
  saveStore();
  return rec;
}

// ─── Cleanup orphan files ──────────────────────────────────────────────────

/**
 * Remove media files on disk that have no matching record in the store.
 * Returns the count of files removed.
 */
function cleanupOrphanMedia(workspace) {
  const mediaDir = path.join(DATA_DIR, "media", workspace.id);
  if (!fs.existsSync(mediaDir)) return 0;

  const knownFiles = new Set(
    (workspace.media || []).map((m) => {
      const p = path.isAbsolute(m.path) ? m.path : path.join(DATA_DIR, m.path);
      return path.basename(p);
    })
  );

  let removed = 0;
  for (const file of fs.readdirSync(mediaDir)) {
    if (!knownFiles.has(file)) {
      try {
        fs.unlinkSync(path.join(mediaDir, file));
        removed++;
      } catch (_) {}
    }
  }
  return removed;
}

module.exports = {
  resolveMediaPath,
  isAllowedMimeType,
  ALLOWED_MIME_TYPES,
  getStorageUsedBytes,
  getStorageUsedMB,
  deleteMedia,
  cleanupOrphanMedia,
};
