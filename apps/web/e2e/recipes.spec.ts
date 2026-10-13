import { expect, test } from "./tour";

import { registerAndSignIn, TEST_TIMEOUT_MS } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
// owner.setup.ts ingests PETR4's candles, so its asset page has a close and
// the recipe's two-year window holds at least those sessions.
const e2eSecret = process.env.E2E_SECRET;
const TICKER = "PETR4";

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the recipe flow.");

test("use a recipe from the asset page and land on its backtest report", async ({
  page,
  baseURL,
  request,
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.goto(`/ativos/${TICKER}`);
  await page.getByRole("link", { name: "Escolher uma receita" }).click();
  await expect(page).toHaveURL(/#receitas$/);
  await expect(page.getByText("Para testar uma receita, informe antes")).toBeVisible();

  await page.goto("/configuracoes");
  await page.getByLabel("Capital declarado").fill("10.000,00");
  await page.getByRole("button", { name: "Salvar perfil de risco" }).click();
  await expect(page.getByText("Perfil de risco salvo.")).toBeVisible();

  await page.goto(`/ativos/${TICKER}`);
  await expect(page.getByRole("heading", { name: "Usar uma receita", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Que suba" }).click();
  await expect(page.getByRole("radio", { name: /Médio: 2% do capital/ })).toBeChecked();
  await expect(page.getByText("cerca de R$ 200,00")).toBeVisible();

  await page.getByRole("button", { name: "Criar e testar: Compra de call" }).click();
  await expect(page).toHaveURL(/\/estrategias\/[^/]+\/backtests\/[^/?]+$/);
  await expect(page.getByText("Curva de patrimônio")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Como ler este resultado" })).toBeVisible();

  await page.getByRole("link", { name: "Abrir a estratégia" }).click();
  await expect(page.getByRole("heading", { name: `Compra de call em ${TICKER}` })).toBeVisible();
});
