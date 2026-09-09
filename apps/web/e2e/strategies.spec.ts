import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the strategy editor flow.");

test("create a strategy, edit it into a new version, share it, and copy it as another user", async ({
  page,
  browser,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.goto("/estrategias");
  await page.getByRole("link", { name: "Nova estratégia" }).click();

  await page.getByLabel("Nome").fill("SMA cruza o fechamento");
  await page.getByRole("button", { name: "Criar estratégia" }).click();

  await expect(page).toHaveURL(/\/estrategias\/[^/]+$/);
  await expect(page.getByText("v1", { exact: false })).toBeVisible();

  await page.getByLabel("Nome").fill("SMA cruza o fechamento (revisado)");
  await page.getByRole("button", { name: "Salvar nova versão" }).click();

  await expect(page.getByText("v2", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Compartilhar" }).click();
  await expect(page.getByRole("button", { name: "Parar de compartilhar" })).toBeVisible();

  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await registerAndSignIn(otherPage, otherContext.request, baseURL, e2eSecret ?? "");

  await otherPage.goto("/estrategias");
  await expect(
    otherPage.getByText("SMA cruza o fechamento (revisado)", { exact: false }),
  ).toBeVisible();
  await otherPage.getByRole("button", { name: "Copiar" }).click();

  await expect(otherPage).toHaveURL(/\/estrategias\/[^/]+$/);
  await expect(otherPage.getByText("v1", { exact: false })).toBeVisible();

  await otherContext.close();
});
