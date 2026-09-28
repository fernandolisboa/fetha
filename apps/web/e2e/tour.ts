import type { Page } from "@playwright/test";
import { expect, test as base } from "@playwright/test";

// Every new account sees the guided tour on its first shell load (#231),
// and its modal card blocks the page underneath. Specs that are not about
// the tour skip it the way a user would, whenever it shows up.
const pagesSkippingTheTour = new WeakSet<Page>();

function tourCard(page: Page) {
  return page.locator("[data-tour-card]");
}

export async function skipTourWhenShown(page: Page): Promise<void> {
  if (pagesSkippingTheTour.has(page)) return;
  pagesSkippingTheTour.add(page);
  await page.addLocatorHandler(tourCard(page), async (card) => {
    await card.getByRole("button", { name: "Pular tour" }).click();
  });
}

// The handler above only runs ahead of clicks and assertions; a spec that
// starts with a key press (Ctrl K) needs the tour closed first. The handler
// is removed so it cannot close the card between the wait and the Escape.
export async function closeTourOnceShown(page: Page): Promise<void> {
  const card = tourCard(page);
  if (pagesSkippingTheTour.delete(page)) {
    await page.removeLocatorHandler(card);
  }
  await card.waitFor();
  await Promise.all([
    page.waitForResponse((res) => res.request().method() === "POST"),
    page.keyboard.press("Escape"),
  ]);
  await card.waitFor({ state: "detached" });
}

export const test = base.extend({
  page: async ({ page }, provide) => {
    await skipTourWhenShown(page);
    await provide(page);
  },
});

export { expect };
