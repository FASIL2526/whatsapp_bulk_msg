/* ─── Backup Routes ────────────────────────────────────────────────────────
 *  Super-admin endpoints for data backup management.
 *  All endpoints require super admin authentication.
 * ─────────────────────────────────────────────────────────────────────────── */

const { Router } = require("express");
const {
  createBackup,
  listBackups,
  deleteBackup,
  restoreFromBackup,
  getBackupStatus,
} = require("../models/store");

const router = Router();

// ─── Helper: super admin check ────────────────────────────────────────────
function isSuperAdmin(req) {
  const adminUsername = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
  return req.user?.username === adminUsername;
}

// ─── GET /admin/backups/status — backup system overview ───────────────────
router.get("/admin/backups/status", (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ ok: false, error: "Super admin access required." });
  try {
    const status = getBackupStatus();
    res.json({ ok: true, ...status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET /admin/backups — list all backups ────────────────────────────────
router.get("/admin/backups", (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ ok: false, error: "Super admin access required." });
  try {
    const backups = listBackups();
    res.json({ ok: true, backups });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── POST /admin/backups/create — manually create a backup ────────────────
router.post("/admin/backups/create", (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ ok: false, error: "Super admin access required." });
  try {
    const result = createBackup("manual");
    if (!result) return res.status(500).json({ ok: false, error: "Backup creation failed." });
    res.json({ ok: true, message: "Backup created successfully.", backup: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── POST /admin/backups/restore — restore from a backup ─────────────────
router.post("/admin/backups/restore", (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ ok: false, error: "Super admin access required." });
  const { filename } = req.body || {};
  if (!filename) return res.status(400).json({ ok: false, error: "Filename is required." });
  try {
    const result = restoreFromBackup(filename);
    res.json({
      ok: true,
      message: `Restored successfully: ${result.users} users, ${result.workspaces} workspaces. A pre-restore backup was saved.`,
      ...result,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── DELETE /admin/backups/:filename — delete a specific backup ───────────
router.delete("/admin/backups/:filename", (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ ok: false, error: "Super admin access required." });
  const { filename } = req.params;
  try {
    const deleted = deleteBackup(filename);
    if (!deleted) return res.status(404).json({ ok: false, error: "Backup not found." });
    res.json({ ok: true, message: `Deleted: ${filename}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET /admin/backups/download/:filename — download a backup ────────────
router.get("/admin/backups/download/:filename", (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ ok: false, error: "Super admin access required." });
  const path = require("path");
  const { BACKUP_DIR } = require("../config/env");
  const safe = path.basename(req.params.filename);
  const fullPath = path.join(BACKUP_DIR, safe);

  const fs = require("fs");
  if (!fs.existsSync(fullPath)) return res.status(404).json({ ok: false, error: "Backup not found." });

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  fs.createReadStream(fullPath).pipe(res);
});

module.exports = router;
