import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
// PETR4 is expected to already be ingested for session 2026-09-09 in the
// preview database (the same assumption watchlist.spec.ts makes). This spec
// declares a risk profile (a signal without one only reaches the
// evaluation log as `unsizeable`, never the inbox), creates a strategy
// whose entry condition ("close > 0") always holds once a candle exists,
// activates it, triggers the nightly cron's manual POST trigger for that
// session (#48, #19), and confirms the resulting signal shows up in the
// inbox as a SignalRow.
const e2eSecret = process.env.E2E_SECRET;
const cronSecret = process.env.CRON_SECRET;
const TICKER = "PETR4";
const SESSION = "2026-09-09";

test.skip(
  !e2eSecret || !cronSecret,
  "E2E_SECRET or CRON_SECRET is not set; skipping the signal inbox flow.",
);

test("a signal appears in the inbox after a triggered evaluation", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.goto("/configuracoes");
  await page.getByLabel("Capital declarado").fill("10.000,00");
  await page.getByRole("button", { name: "Salvar perfil de risco" }).click();
  await expect(page.getByText("Perfil de risco salvo.")).toBeVisible();

  await page.goto(baseURL ?? "/");
  await page.getByRole("button", { name: "Adicionar ativo" }).click();
  await page.getByPlaceholder("Buscar pelo código").fill(TICKER);
  await page.getByRole("option", { name: TICKER, exact: true }).click();

  const runId = `${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
  const strategyName = `Sinal sempre dispara ${runId}`;

  await page.goto("/estrategias");
  await page.getByRole("link", { name: "Nova estratégia" }).click();

  await page.getByLabel("Nome").fill(strategyName);

  await page.getByRole("combobox", { name: "Primeiro valor · Tipo" }).click();
  await page.getByRole("option", { name: "Campo de preço" }).click();

  await page.getByRole("combobox", { name: "Segundo valor · Tipo" }).click();
  await page.getByRole("option", { name: "Constante" }).click();

  // The editor defaults "Estrutura" to the catalog's first structure by
  // name, which is not necessarily this one and can carry strike legs that
  // block submission with an empty strike list; picking it explicitly keeps
  // this spec correct regardless of catalog contents or ordering.
  await page.getByRole("combobox", { name: "Estrutura" }).click();
  await page.getByRole("option", { name: "Compra de ação", exact: true }).click();

  await page.getByRole("button", { name: "Criar estratégia" }).click();
  await expect(page).toHaveURL(/\/estrategias\/(?!nova$)[^/]+$/);

  await page.getByRole("switch", { name: "Ativa" }).click();
  await expect(page.getByRole("switch", { name: "Ativa" })).toBeChecked();

  const triggered = await request.post(`${baseURL ?? ""}/api/cron/ingest`, {
    headers: { authorization: `Bearer ${cronSecret ?? ""}` },
    data: { session: SESSION },
  });
  expect(triggered.ok()).toBe(true);

  await page.goto("/sinais");
  const signalRow = page.getByRole("row", { name: new RegExp(TICKER) });
  await expect(signalRow).toBeVisible();
  await expect(signalRow.getByText("Entrada")).toBeVisible();
  await expect(signalRow.getByText(strategyName)).toBeVisible();
});
