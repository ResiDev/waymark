import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { createServer } from "vite";

/**
 * pnpm --filter waymark-e2e repro:react
 *
 * Starts its own server against current package source. Exits 1 when a healthy
 * behavior assertion fails. Screenshots and measurements go to test-results/react-repros/.
 * Both cases drive the React lab. Layout cases are browser tests in packages/react.
 */
const output = fileURLToPath(new URL("../../test-results/react-repros/", import.meta.url));
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  root: fileURLToPath(new URL("../fixtures/", import.meta.url)),
  server: { host: "127.0.0.1", port: 0, strictPort: false, open: false },
});

type Result = {
  name: string;
  passed: boolean;
  observations: Record<string, unknown>;
  error?: string;
};
const results: Result[] = [];
await server.listen();
const address = server.httpServer?.address();
assert(address && typeof address === "object", "Vite must listen on a TCP port.");
const base = `http://127.0.0.1:${address.port}`;

// Wait through layout and React updates without replacing browser clocks or DOM measurements.
const settle = (page: Page) => page.evaluate(async () => {
  for (let frame = 0; frame < 3; frame++) {
    // oxlint-disable-next-line no-await-in-loop -- consecutive frames let layout and React updates settle
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
});
try {
  const browser = await chromium.launch();
  try {
    const run = async (
      name: string,
      check: (page: Page, result: Result) => Promise<void>,
    ) => {
      const context = await browser.newContext({ viewport: { width: 900, height: 600 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      const result: Result = { name, passed: false, observations: {} };
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await check(page, result);
        assert.deepEqual(errors, [], "The page should have no runtime errors.");
        result.passed = true;
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
      } finally {
        result.observations["pageErrors"] = errors;
        await page.screenshot({ path: `${output}${name}-after.png` });
        results.push(result);
        console.log(`${result.passed ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(result.observations)}`);
        if (result.error) console.log(`  ${result.error}`);
        await context.close();
      }
    };

    await run("keyboard-checklist", async (page, result) => {
      await page.goto(`${base}/react.html?copy=css&lab=0`);
      const trigger = page.locator(".topbar button[aria-expanded]");
      const panel = page.getByRole("dialog", { name: "Getting started", exact: true });
      await trigger.focus();
      await page.keyboard.press("Enter");
      await panel.waitFor();
      await page.keyboard.press("Tab");
      assert(await panel.evaluate((node) => node.contains(document.activeElement)), "Baseline: Tab should reach a checklist control when no walkthrough runs.");
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "hidden" });
      await page.evaluate(() => window.playground.owner.start("tour"));
      await page.getByRole("dialog", { name: /^Step 1 of / }).waitFor();
      await trigger.focus();
      await page.keyboard.press("Enter");
      await panel.waitFor();
      assert(await panel.evaluate((node) => node === document.activeElement), "Keyboard opening must focus the panel before Tab.");
      await page.screenshot({ path: `${output}keyboard-checklist-before.png` });
      await page.keyboard.press("Tab");
      await settle(page);
      result.observations["focusedControl"] = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent);
      result.observations["panelOpen"] = await panel.count() > 0;
      assert(await panel.count() > 0 && await panel.evaluate((node) => node.contains(document.activeElement)), "Tab should reach a checklist control while a walkthrough runs.");
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => {
        const snapshot = window.playground.snapshot();
        return snapshot?.phase === "running" ? snapshot.collapsed : null;
      }), false, "Checklist Escape should not collapse the walkthrough.");
      await page.getByRole("button", { name: "Close", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() => {
        const snapshot = window.playground.snapshot();
        return snapshot?.phase === "running" && snapshot.stepIndex === 1;
      });
    });

    await run("switch-task", async (page, result) => {
      await page.goto(`${base}/react.html?copy=css&lab=0`);
      const trigger = page.locator(".topbar button[aria-expanded]");
      const panel = page.getByRole("dialog", { name: "Getting started", exact: true });
      await trigger.click();
      await panel.locator("li").filter({ hasText: "Take the tour" }).getByRole("button", { name: "Show me", exact: true }).click();
      await panel.waitFor({ state: "hidden" });
      await page.waitForFunction(() => window.playground.owner.getSnapshot().active?.task.id === "tour");
      await trigger.click();
      await panel.waitFor();
      await page.screenshot({ path: `${output}switch-task-before.png` });
      await panel.locator("li").filter({ hasText: "Create your first deck" }).getByRole("button", { name: "Show me", exact: true }).click();
      await page.waitForFunction(() => window.playground.owner.getSnapshot().active?.task.id === "create-deck");
      await settle(page);
      result.observations["activeTask"] = await page.evaluate(() => window.playground.owner.getSnapshot().active?.task.id);
      result.observations["panelOpen"] = await panel.count() > 0;
      assert.equal(await panel.count(), 0, "Starting a replacement task should close the checklist panel.");
    });
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}

await writeFile(`${output}results.json`, `${JSON.stringify(results, null, 2)}\n`);
console.log(`Artifacts: ${output}`);
console.log(`${results.filter((result) => !result.passed).length} failed / ${results.length} scenarios`);
if (results.some((result) => !result.passed)) process.exitCode = 1;
