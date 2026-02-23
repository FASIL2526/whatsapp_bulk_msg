const fs = require("fs");

const SYSTEM_CHROME_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

function configureRuntimeEnv() {
  if (process.env.RENDER === "true" && !process.env.PUPPETEER_CACHE_DIR) {
    process.env.PUPPETEER_CACHE_DIR = "/opt/render/.cache/puppeteer";
  }

  const detectedSystemChrome = SYSTEM_CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || "";
  const currentPuppeteerExecutablePath = String(process.env.PUPPETEER_EXECUTABLE_PATH || "").trim();
  if (detectedSystemChrome && !currentPuppeteerExecutablePath) {
    process.env.PUPPETEER_EXECUTABLE_PATH = detectedSystemChrome;
  }
}

module.exports = {
  configureRuntimeEnv,
  SYSTEM_CHROME_CANDIDATES,
};
