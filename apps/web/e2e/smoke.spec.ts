import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Cards auto-pause the clock and open a modal, and a passed level opens a rank card; dismiss every one that is open before acting. */
async function dismissCards(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const gotIt = page.getByRole("button", { name: "Got it" });
    const rankClose = page.locator("#rank-card-close");
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
    else if (await rankClose.isVisible().catch(() => false)) await rankClose.click();
    else return;
    await page.waitForTimeout(100);
  }
}

/** Plays level 0 end to end in the built app: start, buy a lot, sell it, answer the drills, end, read the debrief. */
test("level 0 end to end, offline, with an axe pass on every screen", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Academy" })).toBeVisible();
  // offline after load: nothing may be fetched at run time
  await context.setOffline(true);
  await page.getByRole("button", { name: /^Start level 0/ }).click();
  await expect(page.getByRole("heading", { name: /Level 0: Orientation/ })).toBeVisible();
  await dismissCards(page);
  // buy one lot on Markets
  await page.getByRole("link", { name: "Markets", exact: true }).click();
  await dismissCards(page);
  await page.locator("#ticket-submit").click();
  await expect(page.getByText(/Bought 1 Brent crude/).first()).toBeVisible();
  await dismissCards(page);
  // let an hour pass at 1x (one tick per two seconds), then pause
  await page.keyboard.press("1");
  await page.waitForTimeout(2600);
  await page.keyboard.press(" ");
  await dismissCards(page);
  // sell it
  await page.getByRole("combobox", { name: "side" }).selectOption("sell");
  await page.locator("#ticket-submit").click();
  await expect(page.getByText(/Sold 1 Brent crude/).first()).toBeVisible();
  await dismissCards(page);
  // drills on the Bridge; the harness exposes the answers the engine computed
  await page.getByRole("link", { name: "Bridge", exact: true }).click();
  await dismissCards(page);
  const answers = await page.evaluate(() => (window as unknown as { __desk?: { drills: () => { id: string; answer: number }[] } }).__desk?.drills() ?? []);
  expect(answers.length).toBe(6);
  for (let i = 0; i < answers.length; i++) {
    const input = page.getByRole("textbox", { name: /answer in/ }).first();
    await input.fill(String(answers[i].answer));
    await page.getByRole("button", { name: "Check" }).first().click();
    await dismissCards(page);
  }
  await expect(page.getByText(/^6 of 6 right\./)).toBeVisible();
  await page.getByRole("button", { name: "End the level now" }).click();
  // a passed level gets a burst and a rank card with the score, the rank and the achievements
  await expect(page.getByRole("dialog", { name: /Orientation/ })).toBeVisible();
  await expect(page.locator(".rankcard")).toContainText("Rank");
  await dismissCards(page);
  await page.getByRole("link", { name: "Debrief", exact: true }).click();
  await expect(page.getByText("passed").first()).toBeVisible();
  // the run is on the leaderboard against the player's own past runs
  await expect(page.locator("#leaderboard")).toContainText(/1st of 1/);
  // accessibility: axe on each screen
  for (const screen of ["Bridge", "Markets", "Book & risk", "Intel", "Finance", "Academy", "Debrief"]) {
    await page.getByRole("link", { name: screen, exact: true }).click();
    await dismissCards(page);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(serious, `${screen}: ${serious.map((v) => `${v.id}: ${v.nodes.length} nodes (${v.nodes[0]?.html.slice(0, 120)})`).join("; ")}`).toEqual([]);
  }
});
