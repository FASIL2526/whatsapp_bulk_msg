/* ─── Knowledge Base (RAG) Service ─────────────────────────────────────────
 *  Upload documents (PDF, TXT, MD, CSV, DOCX), extract text,
 *  chunk into passages, and retrieve relevant context for AI prompts.
 *  Uses simple TF-IDF scoring (no vector DB dependency).
 * ─────────────────────────────────────────────────────────────────────────── */

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../config/env");
const { saveStore } = require("../models/store");
const { sanitizeText } = require("../utils/workspace-config");

const KB_DIR = path.join(DATA_DIR, "knowledge-base");
if (!fs.existsSync(KB_DIR)) fs.mkdirSync(KB_DIR, { recursive: true });

const ALLOWED_TYPES = {
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "application/pdf": ".pdf",
};

const CHUNK_SIZE = 500;  // characters per chunk
const CHUNK_OVERLAP = 100;

// ─── Text extraction ───────────────────────────────────────────────────────
function extractTextFromBuffer(buffer, mimeType, filename) {
  if (mimeType === "application/pdf") {
    return extractPdfText(buffer);
  }
  // Plain text, markdown, CSV — just decode
  return buffer.toString("utf-8");
}

function extractPdfText(buffer) {
  // Simple PDF text extraction — handles most text-based PDFs
  // Extracts text between BT/ET blocks and stream content
  const raw = buffer.toString("latin1");
  const texts = [];

  // Method 1: Extract text objects between BT/ET
  const btEtBlocks = raw.match(/BT[\s\S]*?ET/g) || [];
  for (const block of btEtBlocks) {
    const tjMatches = block.match(/\(([^)]*)\)\s*Tj/g) || [];
    const tdMatches = block.match(/\[([^\]]*)\]\s*TJ/g) || [];
    for (const m of tjMatches) {
      const text = m.match(/\(([^)]*)\)/)?.[1] || "";
      if (text.trim()) texts.push(text);
    }
    for (const m of tdMatches) {
      const inner = m.match(/\[([^\]]*)\]/)?.[1] || "";
      const parts = inner.match(/\(([^)]*)\)/g) || [];
      for (const p of parts) {
        const t = p.replace(/[()]/g, "").trim();
        if (t) texts.push(t);
      }
    }
  }

  // Method 2: Try to extract from decoded streams
  const streamBlocks = raw.match(/stream\r?\n([\s\S]*?)endstream/g) || [];
  for (const sb of streamBlocks) {
    const content = sb.replace(/^stream\r?\n/, "").replace(/\r?\nendstream$/, "");
    // Only use if it looks like readable text
    const readable = content.replace(/[^\x20-\x7E\n\r\t]/g, " ").trim();
    if (readable.length > 20 && /[a-zA-Z]{3,}/.test(readable)) {
      texts.push(readable);
    }
  }

  const result = texts.join(" ").replace(/\s+/g, " ").trim();
  return result || "[PDF text extraction returned empty — try a text-based PDF]";
}

// ─── Chunking ──────────────────────────────────────────────────────────────
function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text || text.length <= chunkSize) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
  }
  return chunks.filter(c => c.trim().length > 10);
}

// ─── Simple TF-IDF retrieval ───────────────────────────────────────────────
function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function computeTfIdf(queryTokens, chunks) {
  const N = chunks.length;
  if (N === 0) return [];

  // Document frequency
  const df = {};
  const chunkTokenSets = chunks.map(c => {
    const tokens = tokenize(c);
    const set = new Set(tokens);
    for (const t of set) df[t] = (df[t] || 0) + 1;
    return { tokens, set };
  });

  // Score each chunk
  return chunks.map((chunk, i) => {
    const { tokens } = chunkTokenSets[i];
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;

    let score = 0;
    for (const qt of queryTokens) {
      if (tf[qt]) {
        const termFreq = tf[qt] / tokens.length;
        const idf = Math.log(N / (df[qt] || 1));
        score += termFreq * idf;
      }
    }
    return { chunk, score, index: i };
  }).sort((a, b) => b.score - a.score);
}

function retrieveRelevantChunks(query, chunks, topK = 5) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return chunks.slice(0, topK);
  const scored = computeTfIdf(queryTokens, chunks);
  return scored.filter(s => s.score > 0).slice(0, topK).map(s => s.chunk);
}

// ─── Workspace KB management ───────────────────────────────────────────────
function ensureKbDir(workspace) {
  const dir = path.join(KB_DIR, workspace.id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getKbDocuments(workspace) {
  if (!Array.isArray(workspace.knowledgeBase)) workspace.knowledgeBase = [];
  return workspace.knowledgeBase;
}

function addDocument(workspace, file) {
  const mimeType = file.mimetype || "";
  if (!ALLOWED_TYPES[mimeType]) {
    throw new Error(`Unsupported file type: ${mimeType}. Allowed: ${Object.keys(ALLOWED_TYPES).join(", ")}`);
  }

  const kbDir = ensureKbDir(workspace);
  const docs = getKbDocuments(workspace);

  // Extract text
  const rawText = extractTextFromBuffer(file.buffer, mimeType, file.originalname);
  if (!rawText || rawText.trim().length < 10) {
    throw new Error("Could not extract meaningful text from file.");
  }

  // Chunk it
  const chunks = chunkText(rawText);
  const docId = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Save raw text to disk
  const textPath = path.join(kbDir, `${docId}.txt`);
  fs.writeFileSync(textPath, rawText, "utf-8");

  // Save doc record
  const doc = {
    id: docId,
    filename: sanitizeText(file.originalname, "document"),
    mimeType,
    sizeBytes: file.buffer.length,
    textPath,
    chunkCount: chunks.length,
    charCount: rawText.length,
    uploadedAt: new Date().toISOString(),
  };
  docs.push(doc);
  saveStore();

  return { doc, chunkCount: chunks.length, charCount: rawText.length };
}

function removeDocument(workspace, docId) {
  const docs = getKbDocuments(workspace);
  const idx = docs.findIndex(d => d.id === docId);
  if (idx === -1) throw new Error("Document not found");

  const doc = docs[idx];
  // Remove text file
  try { if (doc.textPath && fs.existsSync(doc.textPath)) fs.unlinkSync(doc.textPath); } catch (_e) {}
  docs.splice(idx, 1);
  saveStore();
  return doc;
}

function getAllChunksForWorkspace(workspace) {
  const docs = getKbDocuments(workspace);
  const allChunks = [];
  for (const doc of docs) {
    try {
      if (doc.textPath && fs.existsSync(doc.textPath)) {
        const text = fs.readFileSync(doc.textPath, "utf-8");
        const chunks = chunkText(text);
        allChunks.push(...chunks);
      }
    } catch (readErr) {
      console.error(`[KB] Failed to read chunks for doc ${doc.id}:`, readErr.message);
    }
  }
  return allChunks;
}

function buildKbContext(workspace, query, topK = 5) {
  const chunks = getAllChunksForWorkspace(workspace);
  if (chunks.length === 0) return "";
  const relevant = retrieveRelevantChunks(query, chunks, topK);
  if (relevant.length === 0) return "";
  return "─── Knowledge Base Context ───\n" + relevant.join("\n---\n") + "\n─── End Knowledge Base ───";
}

function getKbStats(workspace) {
  const docs = getKbDocuments(workspace);
  const totalChunks = docs.reduce((s, d) => s + (d.chunkCount || 0), 0);
  const totalChars = docs.reduce((s, d) => s + (d.charCount || 0), 0);
  return {
    documentCount: docs.length,
    totalChunks,
    totalChars,
    totalSizeMB: (docs.reduce((s, d) => s + (d.sizeBytes || 0), 0) / 1024 / 1024).toFixed(2),
  };
}

module.exports = {
  ALLOWED_TYPES,
  getKbDocuments,
  addDocument,
  removeDocument,
  getAllChunksForWorkspace,
  buildKbContext,
  retrieveRelevantChunks,
  getKbStats,
};
