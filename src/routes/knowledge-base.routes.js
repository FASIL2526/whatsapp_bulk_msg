/* ─── Knowledge Base Routes ────────────────────────────────────────────────
 *  Upload, list, delete, and query knowledge base documents.
 *  RAG-powered context injection for AI conversations.
 * ─────────────────────────────────────────────────────────────────────────── */

const { Router } = require("express");
const { requireWorkspace } = require("../middleware/auth");
const upload = require("../middleware/upload");
const { saveStore } = require("../models/store");
const {
  getKbDocuments,
  addDocument,
  removeDocument,
  buildKbContext,
  getKbStats,
} = require("../services/knowledge-base.service");
const { getConversationAnalytics } = require("../services/conversation-analytics.service");
const { generateSmartReplies } = require("../services/smart-reply.service");

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════════════════

// List documents
router.get("/:workspaceId/knowledge-base", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const docs = getKbDocuments(workspace);
  const stats = getKbStats(workspace);
  res.json({ ok: true, documents: docs, stats });
});

// Upload document
router.post("/:workspaceId/knowledge-base", upload.single("file"), (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });
  try {
    const result = addDocument(workspace, req.file);
    res.json({
      ok: true,
      document: result.doc,
      chunkCount: result.chunkCount,
      charCount: result.charCount,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Delete document
router.delete("/:workspaceId/knowledge-base/:docId", (req, res) => {
  const workspace = requireWorkspace(req, res, "admin");
  if (!workspace) return;
  try {
    const doc = removeDocument(workspace, req.params.docId);
    res.json({ ok: true, removed: doc.filename });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Search / query (preview what context would be injected)
router.get("/:workspaceId/knowledge-base/search", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const query = req.query.q || "";
  if (!query.trim()) return res.status(400).json({ ok: false, error: "Query parameter 'q' required" });
  const context = buildKbContext(workspace, query, 5);
  res.json({
    ok: true,
    query,
    context: context || "(no relevant context found)",
    hasContext: !!context,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATION ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════

router.get("/:workspaceId/conversation-analytics", (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  const analytics = getConversationAnalytics(workspace, req.query);
  res.json({ ok: true, ...analytics });
});

// ═══════════════════════════════════════════════════════════════════════════
// SMART REPLY SUGGESTIONS
// ═══════════════════════════════════════════════════════════════════════════

router.get("/:workspaceId/agent/takeover/suggestions/:contactId", async (req, res) => {
  const workspace = requireWorkspace(req, res, "member");
  if (!workspace) return;
  try {
    const result = await generateSmartReplies(workspace, req.params.contactId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, suggestions: [] });
  }
});

module.exports = router;
