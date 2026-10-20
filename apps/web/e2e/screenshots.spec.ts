import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { LEVELS } from "@desk/content";

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
  // the money: level 10, seed 1, day 3: letters of credit open, a prepayment made
  await demo(page, 10, 1, 72);
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "Finance", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}finance-lcs.png`, fullPage: false });
  // storage: level 13, seed 1, day 12: a tank with a parcel, deferred paper against it
  await demo(page, 13, 1, 290);
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "Desk", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}desk-tanks.png`, fullPage: false });
});

// ---------------------------------------------------------------- milestone 4: options, the refinery, the LNG chain, signals
// Levels 14 to 17 may not be registered yet; each capture skips until its level exists in LEVELS.
const hasLevel = (id: number) => LEVELS.some((l) => l.id === id);
/** An action can unlock a card, which opens a modal over the screen: dismiss every one that is open before moving on. */
async function dismissCards(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const gotIt = page.getByRole("button", { name: "Got it" });
    if (!(await gotIt.isVisible().catch(() => false))) return;
    await gotIt.click();
    await page.waitForTimeout(100);
  }
}
const shotsDir = () => { const dir = new URL("../../../docs/screenshots/", import.meta.url).pathname; mkdirSync(dir, { recursive: true }); return dir; };

test("markets-options: the chain, the option ticket and the strategy builder (level 16)", async ({ page }) => {
  test.skip(!hasLevel(16), "level 16 (Options) is not registered yet");
  await page.goto("/");
  await demo(page, 16, 1, 58); // day 2, 10:00
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "Markets", exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator("#options").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shotsDir()}markets-options.png`, fullPage: false });
});

test("book-greeks: the Greeks table after an option trade (level 16)", async ({ page }) => {
  test.skip(!hasLevel(16), "level 16 (Options) is not registered yet");
  await page.goto("/");
  await demo(page, 16, 1, 58);
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "Markets", exact: true }).click();
  await page.waitForTimeout(300);
  // buy the at-the-money call from the chain: click its ask, then the ticket's button
  const atmRow = page.locator("#chain tr", { has: page.locator(".badge", { hasText: "ATM" }) }).first();
  await atmRow.locator("td.clickable").nth(1).click();
  await page.locator("#option-submit").click();
  await page.waitForTimeout(200);
  await dismissCards(page);
  await page.getByRole("link", { name: "Book & risk", exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator("#greeks").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shotsDir()}book-greeks.png`, fullPage: false });
});

test("desk-refinery: the plant, its margin and the crack hedge (level 14)", async ({ page }) => {
  test.skip(!hasLevel(14), "level 14 (The refinery) is not registered yet");
  await page.goto("/");
  await demo(page, 14, 1, 130); // day 5, 10:00: four days of margin in the history
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "Desk", exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator("#refinery").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shotsDir()}desk-refinery.png`, fullPage: false });
});

test("desk-lng: an LNG cargo card with its netback and hedge sizes (level 15)", async ({ page }) => {
  test.skip(!hasLevel(15), "level 15 (Gas and LNG) is not registered yet");
  await page.goto("/");
  await demo(page, 15, 1, 250); // day 10, 10:00
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "Desk", exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator("#cargoes").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shotsDir()}desk-lng.png`, fullPage: false });
});

test("intel-signals: the feed after it is bought (level 17)", async ({ page }) => {
  test.skip(!hasLevel(17), "level 17 (Signals) is not registered yet");
  await page.goto("/");
  await demo(page, 17, 1, 130);
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "Intel", exact: true }).click();
  await page.waitForTimeout(300);
  const buy = page.locator("#buy-feed");
  if (await buy.isVisible().catch(() => false)) await buy.click();
  await page.waitForTimeout(200);
  await dismissCards(page);
  await page.locator("#signals").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shotsDir()}intel-signals.png`, fullPage: false });
});

test("map-signals: signal markers on the map (level 17)", async ({ page }) => {
  test.skip(!hasLevel(17), "level 17 (Signals) is not registered yet");
  await page.goto("/");
  await demo(page, 17, 1, 130);
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "Intel", exact: true }).click();
  await page.waitForTimeout(200);
  const buy = page.locator("#buy-feed");
  if (await buy.isVisible().catch(() => false)) await buy.click();
  await page.waitForTimeout(200);
  await dismissCards(page);
  await page.getByRole("link", { name: "Map", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shotsDir()}map-signals.png`, fullPage: false });
});
