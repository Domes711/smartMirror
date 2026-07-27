/* Playwright render of demo.html — one PNG per state.
 *
 * Usage from this directory:
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node demo-render.js
 */
const { chromium } = require("playwright");
const path = require("path");

(async () => {
    const browser = await chromium.launch({
        args: ["--no-sandbox", "--ignore-certificate-errors"]
    });
    const context = await browser.newContext({
        viewport: { width: 460, height: 260 },
        deviceScaleFactor: 2,
        ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    const fileUrl = "file://" + path.resolve(__dirname, "demo.html");
    const scenarios = ["idle", "listening", "processing", "responding", "error"];

    for (const s of scenarios) {
        // Cache-busting query forces a full reload per state (a hash-only
        // change is a same-document navigation and would not re-run the demo).
        await page.goto(fileUrl + "?s=" + s + "#" + s, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        // Let the entrance stagger + a few animation frames settle.
        await page.waitForTimeout(1400);
        const out = path.resolve(__dirname, `render-${s}.png`);
        await page.screenshot({ path: out });
        console.log("saved", out);
    }

    await browser.close();
})();
