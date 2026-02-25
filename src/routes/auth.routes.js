/* ─── Auth Routes ──────────────────────────────────────────────────────────*/

const { Router } = require("express");
const bcrypt = require("bcryptjs");
const {
  store,
  saveStore,
  normalizeUsername,
  getUserByUsername,
} = require("../models/store");
const { requireAuth, authPayload } = require("../middleware/auth");

const router = Router();

router.post("/register", (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");
    if (!username || username.length < 3) {
      return res.status(400).json({ ok: false, error: "Username must be at least 3 chars." });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: "Password must be at least 6 chars." });
    }
    if (getUserByUsername(username)) {
      return res.status(400).json({ ok: false, error: "Username already exists." });
    }
    const user = {
      id: `u_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`,
      username,
      passwordHash: bcrypt.hashSync(password, 10),
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
    saveStore();
    res.json({ ok: true, ...authPayload(user) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/login", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");
  const user = getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ ok: false, error: "Invalid username or password." });
  }
  res.json({ ok: true, ...authPayload(user) });
});

router.get("/me", requireAuth, (req, res) => {
  const { safeUser } = require("../models/store");
  res.json({ ok: true, user: safeUser(req.user) });
});

module.exports = router;
