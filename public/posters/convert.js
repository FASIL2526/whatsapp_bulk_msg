#!/usr/bin/env node
/**
 * High-quality SVG → PNG converter using Puppeteer (headless Chrome).
 * Renders SVGs exactly as they appear in a real browser.
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const DIR = __dirname;
const WIDTH = 2400;
const HEIGHT = 1260;

(async () => {
  const svgs = fs.readdirSync(DIR).filter(f => f.endsWith(".svg"));
  if (!svgs.length) { console.log("No SVG files found."); return; }

  console.log(`Found ${svgs.length} SVG files. Launching Chrome…`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });

  for (const svg of svgs) {
    const svgPath = path.join(DIR, svg);
    const pngPath = svgPath.replace(/\.svg$/, ".png");
    const svgContent = fs.readFileSync(svgPath, "utf-8");

    const html = `<!DOCTYPE html>
<html><head>
<style>
  * { margin: 0; padding: 0; }
  body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    overflow: hidden;
    background: transparent;
  }
  svg {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    display: block;
  }
</style>
</head><body>${svgContent}</body></html>`;

    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 10000 });
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({
      path: pngPath,
      type: "png",
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      omitBackground: false,
    });

    const stat = fs.statSync(pngPath);
    const kb = (stat.size / 1024).toFixed(0);
    console.log(`  ✓ ${svg} → ${path.basename(pngPath)}  (${kb} KB)`);
  }

  await browser.close();
  console.log(`\nDone! ${svgs.length} PNGs rendered at ${WIDTH}×${HEIGHT} via Chrome.`);
})();
