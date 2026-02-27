/* ─── Workspace Routes ─────────────────────────────────────────────────────*/

const { Router } = require("express");
const XLSX = require("xlsx");
const { DEFAULT_CONFIG } = require("../config/default-config");
const {
  store,
  saveStore,
  getWorkspace,
  hasWorkspaceRole,
  toWorkspaceId,
} = require("../models/store");
const { sanitizeWorkspaceConfig, normalizeRecipients } = require("../utils/workspace-config");
const { requireWorkspace } = require("../middleware/auth");
const upload = require("../middleware/upload");
const {
  workspaceSummary,
  setupScheduler,
  setupStatusScheduler,
} = require("../services/whatsapp.service");
const { getRuntime } = require("../models/store");

const router = Router();

router.get("/", (_req, res) => {
  const userId = _req.user.id;
  const allowed = store.workspaces.filter((ws) => hasWorkspaceRole(ws, userId, "member"));
  res.json({ workspaces: allowed.map((ws) => workspaceSummary(ws)) });
});

router.post("/", (req, res) => {
  try {
    const name = require("../utils/workspace-config").sanitizeText(req.body?.name, "New Workspace");
    let id = toWorkspaceId(req.body?.id || name);
    while (getWorkspace(id)) {
      id = `${id}-${Math.floor(Math.random() * 1000)}`;
    }

    store.workspaces.forEach((ws) => {
      if (!ws.config) ws.config = { ...DEFAULT_CONFIG };
      if (!ws.reports) ws.reports = [];
      if (!ws.members) ws.members = [];
      if (!ws.leads) ws.leads = [];
      if (!ws.bookings) ws.bookings = [];
    });
    saveStore();

    const workspace = {
      id,
      name,
      config: { ...DEFAULT_CONFIG },
      reports: [],
      leads: [],
      bookings: [],
      members: [{ userId: req.user.id, role: "owner" }],
      plan: { id: "free", name: "Free", status: "active", startedAt: new Date().toISOString() },
      _usage: { messagesSent: 0, aiCalls: 0, cycleStart: new Date().toISOString(), cycleResetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString() },
      createdAt: new Date().toISOString(),
    };
    store.workspaces.push(workspace);
    saveStore();

    res.json({ ok: true, workspace: workspaceSummary(workspace) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get("/:workspaceId/config", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  res.json(workspace.config);
});

router.post("/:workspaceId/config", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  try {
    workspace.config = sanitizeWorkspaceConfig(req.body || {});
    saveStore();
    const runtime = getRuntime(workspace.id);
    if (runtime.ready) {
      setupScheduler(workspace, runtime);
      setupStatusScheduler(workspace, runtime);
    }
    res.json({ ok: true, config: workspace.config });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ─── Recipients import ─────────────────────────────────────────────────────
function extractNumbersFromWorkbookBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const numbers = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        const onlyDigits = String(cell ?? "").replace(/[^0-9]/g, "");
        if (onlyDigits.length >= 7 && onlyDigits.length <= 15) numbers.push(onlyDigits);
      }
    }
  }
  return numbers;
}

router.post("/:workspaceId/recipients/import", upload.single("file"), (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  if (!req.file?.buffer) {
    return res.status(400).json({ ok: false, error: "File is required." });
  }
  try {
    const imported = extractNumbersFromWorkbookBuffer(req.file.buffer);
    const uniqueImported = [...new Set(imported)];
    const mode = req.body?.mode === "replace" ? "replace" : "append";
    const existing = normalizeRecipients(workspace.config.RECIPIENTS || "");
    const finalList =
      mode === "replace" ? uniqueImported : [...new Set([...existing, ...uniqueImported])];
    workspace.config.RECIPIENTS = finalList.join(",");
    saveStore();
    res.json({ ok: true, mode, importedCount: uniqueImported.length, totalRecipients: finalList.length });
  } catch (err) {
    res.status(400).json({ ok: false, error: `Failed to parse file: ${err.message}` });
  }
});

module.exports = router;
