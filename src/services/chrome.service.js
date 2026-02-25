/* ─── Chrome Service ───────────────────────────────────────────────────────
 *  Chrome/Chromium executable resolution, auto-install,
 *  stale lock cleanup, and diagnostic helpers.
 * ─────────────────────────────────────────────────────────────────────────── */

const fs = require("fs");
const path = require("path");
const { install: installBrowser } = require("@puppeteer/browsers");

// ─── Finder helpers ────────────────────────────────────────────────────────
function findChromeUnderCache(cacheRoot) {
  if (!cacheRoot || !fs.existsSync(cacheRoot)) return "";

  const queue = [{ dir: cacheRoot, depth: 0 }];
  const maxDepth = 6;
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > maxDepth) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch (_err) {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isFile() && entry.name === "chrome") return fullPath;
      if (entry.isDirectory()) queue.push({ dir: fullPath, depth: current.depth + 1 });
    }
  }
  return "";
}

function resolveSystemChromeExecutablePath(skipPaths = []) {
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && !skipPaths.includes(c)) return c;
  }
  return "";
}

function resolveChromeExecutablePath(options = {}) {
  const includeSystem = options.includeSystem !== false;
  const preferSystem = options.preferSystem !== false;
  const ignoreEnv = options.ignoreEnv === true;
  const skipPaths = options.skipPaths || [];

  if (includeSystem && preferSystem) {
    const sys = resolveSystemChromeExecutablePath(skipPaths);
    if (sys) return sys;
  }

  const envPath = ignoreEnv ? "" : (process.env.PUPPETEER_EXECUTABLE_PATH || "").trim();
  if (envPath && fs.existsSync(envPath) && !skipPaths.includes(envPath)) return envPath;

  const cacheCandidates = [
    process.env.PUPPETEER_CACHE_DIR,
    "/workspace/.cache/puppeteer",
    "/opt/render/.cache/puppeteer",
    "/opt/render/project/.cache/puppeteer",
    "/opt/render/project/src/.cache/puppeteer",
    path.join(process.env.HOME || "/opt/render", ".cache", "puppeteer"),
  ].filter(Boolean);

  for (const root of cacheCandidates) {
    const found = findChromeUnderCache(root);
    if (found) return found;
  }

  if (includeSystem) {
    const sys = resolveSystemChromeExecutablePath();
    if (sys) return sys;
  }

  return "";
}

// ─── Diagnostics ───────────────────────────────────────────────────────────
function chromeDebugInfo() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH || "",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    process.env.PUPPETEER_CACHE_DIR || "",
    "/workspace/.cache/puppeteer",
    "/opt/render/.cache/puppeteer",
    "/opt/render/project/.cache/puppeteer",
    "/opt/render/project/src/.cache/puppeteer",
  ].filter(Boolean);

  return {
    render: process.env.RENDER === "true",
    puppeteerCacheDir: process.env.PUPPETEER_CACHE_DIR || "",
    resolvedExecutablePath: resolveChromeExecutablePath(),
    candidatePaths: candidates,
  };
}

function statusHint(lastError) {
  const msg = String(lastError || "");
  if (!msg) return "";
  if (msg.includes("Could not find Chrome"))
    return "Chrome is missing on host. Verify Render build installs Chrome and cache path is set.";
  if (msg.includes("Target.setAutoAttach") || msg.includes("Target closed"))
    return "Chrome started then crashed. Try HEADLESS=true and ensure sandbox/dev-shm flags are enabled.";
  if (msg.includes("The browser is already running for"))
    return "Session profile is locked by another Chromium process. Stop the old process or clear stale session lock files.";
  if (msg.includes("error while loading shared libraries"))
    return "Chrome binary cannot start due to missing OS packages. Install browser runtime libraries (for Debian/Ubuntu: libatk1.0-0 libnss3 libx11-6 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2) or use a Puppeteer-ready container image.";
  if (msg.includes("Timed out after waiting 30000ms"))
    return "Browser startup timed out. On small VPS instances, increase launch/auth timeouts and keep HEADLESS=true.";
  return "";
}

function clearStaleProfileLocks(workspaceId) {
  const sessionDir = path.join(process.cwd(), ".wwebjs_auth", `session-workspace-${workspaceId}`);
  const lockFiles = ["SingletonLock", "SingletonSocket", "SingletonCookie"];
  for (const file of lockFiles) {
    const target = path.join(sessionDir, file);
    if (fs.existsSync(target)) {
      try {
        fs.rmSync(target, { force: true });
      } catch (_err) {
        /* ignore */
      }
    }
  }
}

async function ensureChromeExecutablePath(runtime) {
  const forceSystemChrome = runtime && runtime._forceSystemChrome === true;
  const forceManagedChrome = runtime && runtime._forceManagedChrome === true;
  const skipPaths = (runtime && runtime._failingChromePaths) || [];

  const existing = resolveChromeExecutablePath({
    includeSystem: !forceManagedChrome,
    preferSystem: !forceManagedChrome,
    ignoreEnv: forceSystemChrome || forceManagedChrome,
    skipPaths,
  });
  if (existing) return existing;

  const allowInstall = process.env.AUTO_INSTALL_CHROME !== "false" || forceManagedChrome;
  if (!allowInstall) return "";

  const cacheDir =
    process.env.PUPPETEER_CACHE_DIR ||
    (fs.existsSync("/workspace")
      ? "/workspace/.cache/puppeteer"
      : "/opt/render/.cache/puppeteer");
  const buildId = process.env.CHROME_BUILD_ID || "145.0.7632.77";

  try {
    await installBrowser({ browser: "chrome", buildId, cacheDir });
  } catch (err) {
    if (runtime) runtime.lastError = `Chrome auto-install failed: ${err.message}`;
  }

  const managed = resolveChromeExecutablePath({
    includeSystem: false,
    preferSystem: false,
    ignoreEnv: true,
    skipPaths,
  });
  if (managed) return managed;
  if (forceManagedChrome) return "";
  return resolveChromeExecutablePath({
    includeSystem: true,
    preferSystem: true,
    ignoreEnv: forceSystemChrome || forceManagedChrome,
    skipPaths,
  });
}

module.exports = {
  findChromeUnderCache,
  resolveSystemChromeExecutablePath,
  resolveChromeExecutablePath,
  chromeDebugInfo,
  statusHint,
  clearStaleProfileLocks,
  ensureChromeExecutablePath,
};
