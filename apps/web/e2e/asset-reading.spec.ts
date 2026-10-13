import { expect, test } from "./tour";

import { registerAndSignIn } from "./helpers";

// PETR4 trades in every session owner.setup.ts ingests (see watchlist.spec.ts). How many
// readings it has depends on how much history the preview holds, so this checks that every
// reading row and the next steps render, not which label each one reads.
const e2eSecret = process.env.E2E_SECRET;
const TICKER = "PETR4";

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the asset reading flow.");

test("add an asset, open its page, see its reading and the next steps", async ({
  page,
  baseURL,
  request,
}) => {
  test.setTimeout(90_000);

  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.getByRole("button", { name: "Adicionar ativo" }).click();
  await page.getByPlaceholder("Buscar pelo código").fill(TICKER);
  await page.getByRole("option", { name: TICKER, exact: true }).click();

  const row = page.getByRole("row", { name: new RegExp(TICKER) });
  await expect(row).toBeVisible();
  await expect(page.getByTestId("no-active-strategy")).toBeVisible();

  await row.getByRole("link", { name: TICKER }).click();
  await expect(page).toHaveURL(new RegExp(`/ativos/${TICKER}`));

  const reading = page.locator('[data-tour="asset-reading"]');
  await expect(reading).toBeVisible();
  for (const name of [
    "Tendência",
    "Força (RSI 14)",
    "Oscilação diária (ATR 14)",
    "Volatilidade implícita",
    "Opções",
  ]) {
    await expect(reading.getByText(name, { exact: true })).toBeVisible();
  }

  const nextSteps = page.locator('[data-tour="asset-next-steps"]');
  await expect(nextSteps.getByText("Está na sua watchlist", { exact: false })).toBeVisible();
  await expect(
    nextSteps.getByText("Nenhuma estratégia ativa olha este ativo", { exact: false }),
  ).toBeVisible();

  await nextSteps.getByRole("link", { name: "Abrir o montador" }).click();
  await expect(page).toHaveURL(new RegExp(`/carteira/nova-operacao\\?ticker=${TICKER}`));
  await expect(page.getByLabel("Ativo-objeto", { exact: false })).toHaveValue(TICKER);
});
