/* Playwright render of demo.html — one PNG per scenario. */
const { chromium } = require("playwright");
const path = require("path");

(async () => {
    const browser = await chromium.launch({
        args: ["--no-sandbox", "--ignore-certificate-errors"]
    });
    const context = await browser.newContext({
        viewport: { width: 520, height: 520 },
        deviceScaleFactor: 2,
        ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    const fileUrl = "file://" + path.resolve(__dirname, "demo.html");
    const scenarios = [
        "mixed",
        "warnings",
        "delivered",
        "single",
        "empty",
        "loading",
        "error-ha",
        "error-aftership",
        "error-config"
    ];

    for (const s of scenarios) {
        await page.goto(fileUrl + "#" + s, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(2000);
        const out = path.resolve(__dirname, `render-${s}.png`);
        await page.screenshot({ path: out });
        console.log("saved", out);
    }

    await browser.close();
})();
