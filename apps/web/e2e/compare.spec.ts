import { expect, test, type Page } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md. Like
// backtest.spec.ts, it expects PETR4 candles for the two sessions below to be ingested already,
// and re-ingests the second one first when CRON_SECRET is set.
const e2eSecret = process.env.E2E_SECRET;
const cronSecret = process.env.CRON_SECRET;
const TICKER = "PETR4";
const FROM = "2026-09-08";
const SESSION = "2026-09-09";

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the strategy comparison flow.");

async function runBacktestOfLatestVersion(page: Page, strategyUrl: string): Promise<void> {
  await page.goto(strategyUrl);
  await page.getByRole("link", { name: "Rodar backtest" }).click();
  await expect(page).toHaveURL(/\/backtests\/novo$/);
  await page.locator("label", { hasText: TICKER }).getByRole("checkbox").check();
  await page.getByLabel("De", { exact: true }).fill(FROM);
  await page.getByLabel("Até", { exact: true }).fill(SESSION);
  await page.getByRole("button", { name: "Rodar backtest" }).click();
  await expect(page).toHaveURL(/\/backtests\/(?!novo$)[^/]+$/);
  await page.getByRole("button", { name: /Executar|Continuar/ }).click();
  await expect(page.getByText("Janelas de walk-forward")).toBeVisible();
}

test("compare the backtests of two versions of a strategy", async ({ page, baseURL, request }) => {
  if (cronSecret) {
    const triggered = await request.post(`${baseURL ?? ""}/api/cron/ingest`, {
      headers: { authorization: `Bearer ${cronSecret}` },
      data: { session: SESSION },
    });
    expect(triggered.ok()).toBe(true);
  }

  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.goto("/configuracoes");
  await page.getByLabel("Capital declarado").fill("10.000,00");
  await page.getByRole("button", { name: "Salvar perfil de risco" }).click();
  await expect(page.getByText("Perfil de risco salvo.")).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "Adicionar ativo" }).click();
  await page.getByPlaceholder("Buscar pelo código").fill(TICKER);
  await page.getByRole("option", { name: TICKER, exact: true }).click();
  await expect(page.getByRole("row", { name: new RegExp(TICKER) })).toBeVisible();

  const suffix = `${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
  await page.goto("/estrategias/nova");
  await page.getByLabel("Nome").fill(`Comparação ${suffix}`);
  await page.getByRole("combobox", { name: "Estrutura" }).click();
  await page.getByRole("option", { name: "Compra de ação", exact: true }).click();
  await page.getByRole("button", { name: "Criar estratégia" }).click();
  await expect(page).toHaveURL(/\/estrategias\/(?!nova$)[^/]+$/);
  const strategyUrl = page.url();

  await runBacktestOfLatestVersion(page, strategyUrl);

  await page.goto(strategyUrl);
  await page.getByLabel("Nome").fill(`Comparação ${suffix} revisada`);
  await page.getByRole("button", { name: "Salvar nova versão" }).click();
  await expect(page.getByText("v2", { exact: false })).toBeVisible();

  await runBacktestOfLatestVersion(page, strategyUrl);

  await page.goto("/estrategias/comparar");
  const picker = page.locator("fieldset", { hasText: `Comparação ${suffix}` });
  await picker.locator("label", { hasText: "v1" }).getByRole("checkbox").check();
  await picker.locator("label", { hasText: "v2" }).getByRole("checkbox").check();
  await page.getByRole("link", { name: "Comparar", exact: true }).click();

  await expect(page).toHaveURL(/\/estrategias\/comparar\?run=.+&run=.+/);
  await expect(page.getByRole("heading", { name: "Métricas" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "v1" }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "v2" }).first()).toBeVisible();
  await expect(page.getByText("Retorno acumulado")).toBeVisible();
});
