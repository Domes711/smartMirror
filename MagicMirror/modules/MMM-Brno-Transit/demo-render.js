/* Playwright script: open demo.html for each scenario and save a PNG.
 *
 * Usage (from this dir):
 *     PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *       node /opt/node22/bin/playwright --help   # just to confirm install
 *     node demo-render.js
 *
 * Outputs render-<scenario>.png next to this script.
 */
const { chromium } = require("playwright");
const path = require("path");

(async () => {
    const browser = await chromium.launch({
        args: ["--no-sandbox", "--ignore-certificate-errors"]
    });
    const context = await browser.newContext({
        viewport: { width: 520, height: 360 },
        deviceScaleFactor: 2,
        ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    const fileUrl = "file://" + path.resolve(__dirname, "demo.html");
    const scenarios = ["realtime", "scheduled", "rush", "empty"];

    for (const s of scenarios) {
        await page.goto(fileUrl + "#" + s, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        // allow FA web fonts to actually paint
        await page.waitForTimeout(2000);
        const out = path.resolve(__dirname, `render-${s}.png`);
        await page.screenshot({ path: out });
        console.log("saved", out);
    }

    await browser.close();
})();
