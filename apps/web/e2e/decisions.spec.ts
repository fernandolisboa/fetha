import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
// Extends signals.spec.ts's own flow (declares a risk profile, creates and
// activates a stock-only "always fires" strategy, triggers the nightly
// cron's manual POST trigger) one step further: records "Não entrar" on the
// resulting signal and confirms the journal shows it.
const e2eSecret = process.env.E2E_SECRET;
const cronSecret = process.env.CRON_SECRET;
const TICKER = "PETR4";
const SESSION = "2026-09-09";
const RATIONALE = "Sem margem de segurança suficiente para entrar agora.";

test.skip(
  !e2eSecret || !cronSecret,
  "E2E_SECRET or CRON_SECRET is not set; skipping the decision journal flow.",
);

test('recording "não entrar" on a signal shows it in the journal', async ({
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
  const strategyName = `Decisão de diário ${runId}`;

  await page.goto("/estrategias");
  await page.getByRole("link", { name: "Nova estratégia" }).click();

  await page.getByLabel("Nome").fill(strategyName);

  await page.getByRole("combobox", { name: "Primeiro valor · Tipo" }).click();
  await page.getByRole("option", { name: "Campo de preço" }).click();

  await page.getByRole("combobox", { name: "Segundo valor · Tipo" }).click();
  await page.getByRole("option", { name: "Constante" }).click();

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
  const inbox = page.getByRole("table", { name: "Caixa de entrada" });
  const signalRow = inbox.getByRole("row", { name: new RegExp(TICKER) });
  await expect(signalRow).toBeVisible();

  await signalRow.getByRole("button", { name: "Registrar decisão" }).click();

  const dialog = page.getByRole("dialog", { name: "Registrar decisão" });
  await dialog.getByRole("button", { name: "Não entrar", exact: true }).click();
  await dialog.getByLabel("Justificativa").fill(RATIONALE);
  await dialog.getByLabel("Confiança (%)").fill("70");
  await dialog.getByLabel("Horizonte").fill("2030-01-01");
  await dialog.getByRole("button", { name: "Salvar decisão" }).click();

  await expect(dialog).not.toBeVisible();
  await expect(signalRow.getByText("Não entrar")).toBeVisible();

  await page.goto("/diario");
  await expect(page.getByText("Não entrar", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(RATIONALE)).toBeVisible();
});
