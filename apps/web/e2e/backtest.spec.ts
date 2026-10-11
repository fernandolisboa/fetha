import { expect, test } from "./tour";

import { registerAndSignIn, TEST_TIMEOUT_MS } from "./helpers";
import { FROM_SESSION, TO_SESSION } from "./sessions";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
// owner.setup.ts ingests PETR4's candles for both sessions of the window
// below before this spec runs.
const e2eSecret = process.env.E2E_SECRET;
const TICKER = "PETR4";

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the backtest run-and-report flow.");

test("run a backtest and open its report", async ({ page, baseURL, request }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
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

  // getByLabel matches by substring: "De" also matches "Modelo de custos"
  // and "Limites de risco" further down this same form, and "Até" is one
  // word away from the same fate the moment a label containing "até"
  // appears. Exact keeps both queries tied to their own date input instead
  // of Playwright's strict-mode check picking that ambiguity up first.
  await page.getByLabel("De", { exact: true }).fill(FROM_SESSION);
  await page.getByLabel("Até", { exact: true }).fill(TO_SESSION);
  await page.getByRole("button", { name: "Rodar backtest" }).click();

  await expect(page).toHaveURL(/\/backtests\/(?!novo$)[^/]+$/);

  await page.getByRole("button", { name: /Executar|Continuar/ }).click();
  await expect(page.getByText("Curva de patrimônio")).toBeVisible();
  // visx's ParentSize clips the chart to its own measured box, so a chart
  // with no explicit height is in the DOM yet drawn 0px tall.
  const equityChart = page.getByRole("img", { name: "Curva de patrimônio" });
  await expect
    .poll(() => equityChart.evaluate((svg) => svg.parentElement?.clientHeight ?? 0))
    .toBeGreaterThan(0);
});
