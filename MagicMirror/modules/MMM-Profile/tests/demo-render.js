/* Playwright render of tests/demo.html — one PNG per state. */
const { chromium } = require("playwright");
const path = require("path");

(async () => {
    const browser = await chromium.launch({
        args: ["--no-sandbox", "--ignore-certificate-errors"]
    });
    const context = await browser.newContext({
        viewport: { width: 480, height: 360 },
        deviceScaleFactor: 2,
        ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    const fileUrl = "file://" + path.resolve(__dirname, "demo.html");
    const scenarios = ["asleep", "scanning", "user", "unknown"];

    for (const s of scenarios) {
        await page.goto(fileUrl + "#" + s, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        // Freeze the rotating ring + breathing animations on a known frame
        // so the screenshot is reproducible. Pause via CSS animation-play-state.
        await page.addStyleTag({
            content: ".mmp-scan-svg, .mmp-dot, .mmp-avatar { animation-play-state: paused !important; }"
        });
        await page.waitForTimeout(800);
        const out = path.resolve(__dirname, `render-${s}.png`);
        await page.screenshot({ path: out });
        console.log("saved", out);
    }

    await browser.close();
})();
