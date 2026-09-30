import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Locator, type Page } from "playwright";
import { createServer } from "vite";

/**
 * pnpm --filter waymark-e2e repro:react
 *
 * Starts its own server against current package source. Exits 1 when a healthy
 * behavior assertion fails. Screenshots and measurements go to test-results/react-repros/.
 * The first two cases drive the existing React lab; layout cases use repro.html.
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
const bounds = (element: Locator) => element.evaluate((node) => {
  const { top, bottom, left, right, width, height } = node.getBoundingClientRect();
  return { top, bottom, left, right, width, height, viewportWidth: innerWidth, viewportHeight: innerHeight };
});
const fits = (rect: Awaited<ReturnType<typeof bounds>>) => {
  assert(rect.left >= 0 && rect.right <= rect.viewportWidth, `Horizontal bounds ${rect.left}..${rect.right} exceed viewport 0..${rect.viewportWidth}.`);
  assert(rect.top >= 0 && rect.bottom <= rect.viewportHeight, `Vertical bounds ${rect.top}..${rect.bottom} exceed viewport 0..${rect.viewportHeight}.`);
};

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
      await page.getByRole("dialog", { name: "Step 1 of 8", exact: true }).waitFor();
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
      await page.waitForFunction(() => window.playground.snapshot()?.stepIndex === 1);
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

    await run("viewport-resize", async (page, result) => {
      await page.goto(`${base}/repro.html?case=resize`);
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await settle(page);
      result.observations["before"] = await bounds(dialog);
      fits(await bounds(dialog));
      await page.screenshot({ path: `${output}viewport-resize-before.png` });
      await page.setViewportSize({ width: 320, height: 600 });
      await settle(page);
      const after = await bounds(dialog);
      result.observations["after"] = after;
      fits(after);
    });

    await run("content-growth", async (page, result) => {
      await page.goto(`${base}/repro.html?case=content`);
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await settle(page);
      result.observations["before"] = await bounds(dialog);
      fits(await bounds(dialog));
      await page.screenshot({ path: `${output}content-growth-before.png` });
      await dialog.getByRole("button", { name: "Expand content" }).click();
      await page.getByText("The child grew without changing the walkthrough or its waymark.").waitFor();
      await settle(page);
      const after = await bounds(dialog);
      result.observations["after"] = after;
      const finishButton = await bounds(dialog.getByRole("button", { name: "Finish walkthrough" }));
      result.observations["finishButton"] = finishButton;
      fits(finishButton);
      fits(after);
      await page.screenshot({ path: `${output}content-growth-positioned.png` });
      await dialog.getByRole("button", { name: "Finish walkthrough" }).click();
      await dialog.waitFor({ state: "hidden" });
    });

    await run("general-guidance-resize", async (page, result) => {
      await page.goto(`${base}/repro.html?case=general`);
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await settle(page);
      result.observations["before"] = await bounds(dialog);
      await page.setViewportSize({ width: 320, height: 480 });
      await settle(page);
      const after = await bounds(dialog);
      result.observations["after"] = after;
      fits(after);
      assert.equal(after.left + after.width / 2, 160, "General guidance should remain horizontally centered after resize.");
      assert.equal(after.top, 248, "General guidance should follow the new viewport's vertical center.");
    });

    await run("beacon-resize", async (page, result) => {
      await page.goto(`${base}/repro.html?case=general`);
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      const beacon = page.getByRole("button", { name: "Resume walkthrough", exact: true });
      await beacon.waitFor();
      result.observations["before"] = await bounds(beacon);
      await page.setViewportSize({ width: 320, height: 480 });
      await settle(page);
      const after = await bounds(beacon);
      result.observations["after"] = after;
      fits(after);
      assert.equal(after.left + after.width / 2, 160, "The beacon should follow the new viewport's horizontal center.");
      assert.equal(after.top + after.height / 2, 448, "The beacon should stay 32px above the new viewport's bottom.");
      await beacon.click();
      await page.getByRole("dialog").waitFor();
    });

    await run("transformed-parent", async (page, result) => {
      await page.goto(`${base}/repro.html?case=transform`);
      const dialog = page.getByRole("dialog");
      const waymark = page.locator("#waymark");
      await dialog.waitFor();
      await settle(page);
      const before = await bounds(dialog);
      const waymarkBefore = await bounds(waymark);
      result.observations["before"] = { dialog: before, waymark: waymarkBefore };
      assert.equal(before.top - waymarkBefore.bottom, 8, "Baseline: the dialog should be 8px below its waymark.");
      await page.screenshot({ path: `${output}transformed-parent-before.png` });
      await page.getByRole("button", { name: "Move parent" }).click();
      await settle(page);
      const after = await bounds(dialog);
      const waymarkAfter = await bounds(waymark);
      result.observations["after"] = { dialog: after, waymark: waymarkAfter };
      assert.deepEqual(waymarkAfter, waymarkBefore, "The page element must stay stationary.");
      assert.equal(after.top - waymarkAfter.bottom, 8, "A parent transform should not change the dialog's 8px gap from its stationary waymark.");
      assert.equal(after.left, before.left, "A parent transform should not shift the dialog horizontally.");
      await page.screenshot({ path: `${output}transformed-parent-positioned.png` });
      const shade = page.locator('body > div[aria-hidden="true"]');
      assert.equal((await bounds(shade)).left, waymarkAfter.left, "The shade's opening should remain on the waymark.");
      assert.equal((await bounds(shade)).top, waymarkAfter.top, "The shade's opening should remain on the waymark.");
      await dialog.getByRole("button", { name: "Close", exact: true }).focus();
      await page.keyboard.press("Escape");
      const beacon = page.getByRole("button", { name: "Resume walkthrough", exact: true });
      await beacon.waitFor();
      const beaconRect = await bounds(beacon);
      assert.equal(beaconRect.left + beaconRect.width / 2, waymarkAfter.right, "The beacon should remain on its waymark under a parent transform.");
      assert.equal(beaconRect.top + beaconRect.height / 2, waymarkAfter.top, "The beacon should remain on its waymark under a parent transform.");
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
