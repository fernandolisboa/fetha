import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
// PETR4 is expected to have a candle for session 2026-09-09 already ingested
// (the nightly job, #12); when CRON_SECRET is also set this spec triggers a
// manual re-ingestion of that session first, the same way
// ingestion-trigger.spec.ts does, so the run below always has real data to
// simulate against instead of depending on when the preview was last seeded.
const e2eSecret = process.env.E2E_SECRET;
const cronSecret = process.env.CRON_SECRET;
const TICKER = "PETR4";
const SESSION = "2026-09-09";

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the backtest run-and-report flow.");

test("run a backtest and open its report", async ({ page, baseURL, request }) => {
  if (cronSecret) {
    const triggered = await request.post(`${baseURL ?? ""}/api/cron/ingest`, {
      headers: { authorization: `Bearer ${cronSecret}` },
      data: { session: SESSION },
    });
    expect(triggered.ok()).toBe(true);
  }

  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  // A backtest run refuses to create without a declared risk profile (its
  // limits are the user's own, never a fabricated unconstrained default).
  await page.goto("/configuracoes");
  await page.getByLabel("Capital declarado").fill("10.000,00");
  await page.getByRole("button", { name: "Salvar perfil de risco" }).click();
  await expect(page.getByText("Perfil de risco salvo.")).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "Adicionar ativo" }).click();
  await page.getByPlaceholder("Buscar pelo código").fill(TICKER);
  await page.getByRole("option", { name: TICKER, exact: true }).click();
  await expect(page.getByRole("row", { name: new RegExp(TICKER) })).toBeVisible();

  const runId = `${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
  const strategyName = `Fechamento positivo ${runId}`;

  await page.goto("/estrategias");
  await page.getByRole("link", { name: "Nova estratégia" }).click();
  await page.getByLabel("Nome").fill(strategyName);

  // The editor defaults "Estrutura" to the catalog's first structure by
  // name, which is not necessarily this one and can carry strike legs that
  // block submission with an empty strike list; picking it explicitly keeps
  // this spec correct regardless of catalog contents or ordering.
  await page.getByRole("combobox", { name: "Estrutura" }).click();
  await page.getByRole("option", { name: "Compra de ação", exact: true }).click();

  await page.getByRole("button", { name: "Criar estratégia" }).click();
  await expect(page).toHaveURL(/\/estrategias\/(?!nova$)[^/]+$/);

  await page.getByRole("link", { name: "Rodar backtest" }).click();
  await expect(page).toHaveURL(/\/backtests\/novo$/);

  await page.locator("label", { hasText: TICKER }).getByRole("checkbox").check();
  await page.getByLabel("De").fill("2026-09-08");
  await page.getByLabel("Até").fill(SESSION);
  await page.getByRole("button", { name: "Rodar backtest" }).click();

  await expect(page).toHaveURL(/\/backtests\/(?!novo$)[^/]+$/);

  await page.getByRole("button", { name: /Executar|Continuar/ }).click();
  await expect(page.getByText("Curva de patrimônio")).toBeVisible();
});
