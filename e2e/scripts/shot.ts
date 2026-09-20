import { chromium } from "playwright";

/**
 * Screenshot a fixture page in the state a URL describes.
 *
 *   pnpm shot                                   default walkthrough
 *   pnpm shot '?situations=sticky&startAt=2'    any query the page accepts
 *   pnpm shot checklist.html                    another fixture page
 *   pnpm shot '?...' out.png 800                 output path and a wait in ms
 *
 * The dev server must be running: pnpm dev.
 */
const [target = "", out = "shot.png", wait = "300"] = process.argv.slice(2);
const query = target.startsWith("?") || target === "" || target.includes(".html") ? target : `?${target}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on("pageerror", (error) => console.error("page error:", error.message));
await page.goto(`http://localhost:4173/${query}`);
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
await browser.close();
console.log(out);
