import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
// PETR4 is one of B3's most liquid tickers and is expected to be present in
// every ingested session, so it stands in for "any instrument the nightly
// job (#12) has already loaded" without this spec seeding its own candles.
const e2eSecret = process.env.E2E_SECRET;
const TICKER = "PETR4";

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the watchlist and chart flow.");

test("add an instrument to the watchlist and open its chart", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.getByRole("button", { name: "Adicionar ativo" }).click();
  await page.getByPlaceholder("Buscar pelo código").fill(TICKER);
  await page.getByRole("option", { name: TICKER, exact: true }).click();

  const row = page.getByRole("row", { name: new RegExp(TICKER) });
  await expect(row).toBeVisible();

  await row.getByRole("link", { name: TICKER }).click();

  await expect(page).toHaveURL(new RegExp(`/ativos/${TICKER}`));
  await expect(page.getByRole("heading", { name: TICKER })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Ajustada" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Nominal" })).toBeVisible();

  await page.getByRole("tab", { name: "Nominal" }).click();
  await expect(page).toHaveURL(/form=nominal/);
});
