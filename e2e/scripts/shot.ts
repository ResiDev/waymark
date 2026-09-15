import { chromium } from "playwright";
import type { ScenarioName } from "../fixtures/main";

/**
 * Screenshot the fixture page in a given scenario, for a human or an agent to look at.
 *
 *   pnpm shot <scenario> [out.png]     (dev server must be running: pnpm dev)
 */
const [scenario = "tour", out = "shot.png"] = process.argv.slice(2);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto("http://localhost:4173/");
await page.evaluate((name) => window.waymark.start(name), scenario as ScenarioName);
await page.waitForTimeout(100);
await page.screenshot({ path: out });
await browser.close();
console.log(out);
