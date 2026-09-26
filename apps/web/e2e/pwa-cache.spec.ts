import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the PWA cache flow.");

async function cachedUrls(page: Page): Promise<URL[]> {
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

function userData(urls: URL[]): string[] {
  return urls
    .filter(
      (url) =>
        url.pathname.startsWith("/api/") ||
        url.searchParams.has("_rsc") ||
        !/\.[a-z0-9]+$/i.test(url.pathname),
    )
    .map((url) => url.pathname + url.search);
}

test("the service worker never stores pages or API responses", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await page.getByRole("link", { name: "Carteira" }).click();
  await expect(page).toHaveURL(/\/carteira/);
  expect(await page.evaluate(() => fetch("/api/auth/get-session").then((r) => r.status))).toBe(200);

  expect(userData(await cachedUrls(page))).toEqual([]);

  await page.getByRole("button", { name: "Menu da conta" }).click();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar/);

  const afterSignOut = await cachedUrls(page);
  expect(userData(afterSignOut)).toEqual([]);
  expect(afterSignOut.map((url) => url.pathname)).toContain("/offline.html");

  const offlinePage = await page.evaluate(async () => {
    const response = await caches.match("/offline.html", { ignoreSearch: true });
    return response ? response.text() : null;
  });
  expect(offlinePage).toContain("Sem conexão");
});
