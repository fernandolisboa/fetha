import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the workstation shell flow.");

test("shell renders after login with the six destinations", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await expect(page.getByRole("link", { name: "Watchlist" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sinais" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Estratégias" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Carteira" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Diário" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Configurações" })).toBeVisible();
  await expect(page.getByText("sem dados")).toBeVisible();
});

test("theme switch persists across reload", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "terminal");

  await page.getByRole("button", { name: "Menu da conta" }).click();
  await page.getByRole("link", { name: "Configurações" }).click();
  await expect(page).toHaveURL(/\/configuracoes/);

  await page.getByRole("radio", { name: /Terminal/ }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "terminal");

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "terminal");
});

test("rail collapse persists across reload", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const [response] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === "POST"),
    page.getByRole("button", { name: "Recolher a navegação" }).click(),
  ]);
  expect(response.ok()).toBe(true);
  await expect(page.getByText("Watchlist", { exact: true })).toBeHidden();

  await page.reload();

  await expect(page.getByText("Watchlist", { exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "Watchlist" })).toBeVisible();
});

test("PWA manifest and service worker are served", async ({ request, baseURL }) => {
  const manifestResponse = await request.get(`${baseURL ?? ""}/manifest.webmanifest`);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as { name: string };
  expect(manifest.name).toBe("Fetha");

  const swResponse = await request.get(`${baseURL ?? ""}/sw.js`);
  expect(swResponse.ok()).toBe(true);
});
