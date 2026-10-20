import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

type Harness = { demo: (level: number, seed: number, tick: number) => void };
const demo = (page: Parameters<Parameters<typeof test>[1]>[0]["page"], level: number, seed: number, tick: number) =>
  page.evaluate(([l, s, t]) => (window as unknown as { __desk: Harness }).__desk.demo(l, s, t), [level, seed, tick] as const);

/** Captures each screen at a fixed tick of a fixed seed, committed under docs/screenshots/. */
test("screenshots of every screen at a fixed tick", async ({ page }) => {
  const dir = new URL("../../../docs/screenshots/", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  await page.goto("/");
  // the paper desk: level 1, seed 1, day 4
  await demo(page, 1, 1, 100);
  await page.waitForTimeout(300);
  for (const [name, link] of [["bridge", "Bridge"], ["markets", "Markets"], ["book", "Book & risk"], ["intel", "Intel"], ["finance", "Finance"], ["academy", "Academy"]] as const) {
    await page.getByRole("link", { name: link, exact: true }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${dir}${name}.png`, fullPage: false });
  }
  await demo(page, 1, 1, 1000);
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "Debrief", exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}debrief.png`, fullPage: false });
  // the physical desk: level 9, seed 1, day 13: the ship is held at Bab el-Mandeb
  await demo(page, 9, 1, 300);
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "Desk", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}desk.png`, fullPage: false });
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}map.png`, fullPage: false });
  await page.getByRole("link", { name: "Book & risk", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}book-physical.png`, fullPage: false });
});
