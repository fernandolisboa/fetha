import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
const e2eSecret = process.env.E2E_SECRET;

async function cachedUrls(page: Page): Promise<URL[]> {
  // A worker writes to Cache Storage after the response reaches the page, so
  // an empty read right after a request proves nothing; let writes land first.
  await page.waitForTimeout(1_000);
  const urls = await page.evaluate(async () => {
    const found: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      found.push(...(await cache.keys()).map((request) => request.url));
    }
    return found;
  });
  return urls.map((url) => new URL(url));
}

function outsideBuildOutput(urls: URL[]): string[] {
  return urls
    .filter(
      (url) =>
        !url.pathname.startsWith("/_next/static/") &&
        !url.pathname.startsWith("/icons/") &&
        url.pathname !== "/offline.html",
    )
    .map((url) => url.pathname + url.search);
}

test("the service worker never stores pages or API responses", async ({
  page,
  baseURL,
  request,
}) => {
  test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the signed-in cache flow.");

  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await page.getByRole("link", { name: "Carteira" }).click();
  await expect(page).toHaveURL(/\/carteira/);
  expect(await page.evaluate(() => fetch("/api/auth/get-session").then((r) => r.status))).toBe(200);

  expect(outsideBuildOutput(await cachedUrls(page))).toEqual([]);

  await page.getByRole("button", { name: "Menu da conta" }).click();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar/);

  const afterSignOut = await cachedUrls(page);
  expect(outsideBuildOutput(afterSignOut)).toEqual([]);
  expect(afterSignOut.map((url) => url.pathname)).toContain("/offline.html");

  const offlinePage = await page.evaluate(async () => {
    const response = await caches.match("/offline.html", { ignoreSearch: true });
    return response ? response.text() : null;
  });
  expect(offlinePage).toContain("Sem conexão");
});

test("an offline navigation shows the static offline page", async ({ page, context }) => {
  await page.goto("/entrar");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.goto("/carteira");

  await expect(page.getByRole("heading", { name: "Sem conexão" })).toBeVisible();
});
