import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

/** Captures each screen at a fixed tick of a fixed seed, committed under docs/screenshots/. */
test("screenshots of every screen at a fixed tick", async ({ page }) => {
  const dir = new URL("../../../docs/screenshots/", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  await page.goto("/");
  // use the exposed harness to put the app in a known state: level 1, seed 1, tick 100 with the bot's actions
  await page.evaluate(() => (window as unknown as { __desk: { demo: (level: number, seed: number, tick: number) => void } }).__desk.demo(1, 1, 100));
  await page.waitForTimeout(300);
  for (const [name, link] of [["bridge", "Bridge"], ["markets", "Markets"], ["book", "Book & risk"], ["intel", "Intel"], ["finance", "Finance"], ["academy", "Academy"]] as const) {
    await page.getByRole("link", { name: link, exact: true }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${dir}${name}.png`, fullPage: false });
  }
  await page.evaluate(() => (window as unknown as { __desk: { demo: (level: number, seed: number, tick: number) => void } }).__desk.demo(1, 1, 1000));
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "Debrief", exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}debrief.png`, fullPage: false });
});
