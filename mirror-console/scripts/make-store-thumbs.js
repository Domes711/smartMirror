#!/usr/bin/env node
// Generate store-thumb.png for every own module that has demo.html.
// Usage: node make-store-thumbs.js [--module MMM-Foo]
//
// Requires: playwright available via npx (no install needed).
// Run from the repo root or mirror-console/scripts/.

const path = require("path");
const fs   = require("fs");

const REPO_ROOT   = path.resolve(__dirname, "..", "..");
const MODULES_DIR = path.join(REPO_ROOT, "MagicMirror", "modules");

// Find playwright in npx cache or node_modules.
function findPlaywright() {
  const candidates = [
    path.join(__dirname, "..", "node_modules", "playwright"),
    path.join(__dirname, "..", "server", "node_modules", "playwright"),
  ];
  // npx cache
  const npxCache = path.join(require("os").homedir(), ".npm", "_npx");
  if (fs.existsSync(npxCache)) {
    for (const hash of fs.readdirSync(npxCache)) {
      const p = path.join(npxCache, hash, "node_modules", "playwright");
      if (fs.existsSync(path.join(p, "index.js"))) candidates.unshift(p);
    }
  }
  return candidates.find(p => fs.existsSync(path.join(p, "index.js")));
}

async function screenshot(chromium, name) {
  const dir      = path.join(MODULES_DIR, name);
  const demoPath = path.join(dir, "demo.html");
  const thumbPath = path.join(dir, "store-thumb.png");

  if (!fs.existsSync(demoPath)) {
    console.log(`  ✗  ${name}  — demo.html chybí, přeskakuji`);
    return false;
  }

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 480, height: 300 });
    await page.goto(`file://${demoPath}`, { waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(1400);
    await page.screenshot({ path: thumbPath });
    console.log(`  ✓  ${name}  → store-thumb.png`);
    return true;
  } finally {
    await browser.close();
  }
}

(async () => {
  const pwPath = findPlaywright();
  if (!pwPath) {
    console.error("playwright nenalezen — spusť: npx playwright install chromium");
    process.exit(1);
  }
  const { chromium } = require(pwPath);

  const argModule = process.argv.includes("--module")
    ? process.argv[process.argv.indexOf("--module") + 1]
    : null;

  const modules = fs.readdirSync(MODULES_DIR)
    .filter(d => d.startsWith("MMM-") && fs.statSync(path.join(MODULES_DIR, d)).isDirectory())
    .filter(d => !argModule || d === argModule);

  console.log(`\nGeneruji store-thumb.png pro ${modules.length} modulů…\n`);
  let ok = 0, skipped = 0;
  for (const name of modules) {
    const result = await screenshot(chromium, name);
    result ? ok++ : skipped++;
  }
  console.log(`\nHotovo: ${ok} screenshotů, ${skipped} přeskočeno (chybí demo.html).`);
})().catch(e => { console.error(e); process.exit(1); });
