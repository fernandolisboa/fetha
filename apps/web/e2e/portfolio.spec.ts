import path from "node:path";

import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
// Imports the synthetic B3 "Negociação" fixture, then records a fill in a real
// expired PETR4 series (found through the E2E-only `/api/e2e/expired-series`
// route) and confirms its settlement proposal (#26 acceptance criteria).
const e2eSecret = process.env.E2E_SECRET;
const fixture = path.join(
  __dirname,
  "..",
  "src/modules/portfolio/b3-import/fixtures/negociacao.xlsx",
);

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the real portfolio flow.");

interface ExpiredSeries {
  ticker: string;
  session: string;
  expiry: string;
  close: string;
}

test("imports the B3 spreadsheet, shows positions and settles an expired series", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const lookup = await page.request.get("/api/e2e/expired-series", {
    headers: { "x-e2e-secret": e2eSecret ?? "" },
  });
  expect(lookup.ok()).toBe(true);
  const series = (await lookup.json()) as ExpiredSeries;

  await page.goto("/carteira");

  await page.getByRole("button", { name: "Importar planilha da B3" }).click();
  const importDialog = page.getByRole("dialog");
  await importDialog.getByLabel("Planilha").setInputFiles(fixture);
  await importDialog.getByRole("button", { name: "Importar" }).click();
  await expect(importDialog.getByText(/6 execuções importadas, 0 já estavam/)).toBeVisible();
  await page.keyboard.press("Escape");

  const positions = page.locator("section", { hasText: "Posições" }).first();
  await expect(positions.getByRole("cell", { name: "PETR4", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Registrar execução" }).click();
  const recordDialog = page.getByRole("dialog");
  await recordDialog.getByLabel("Ativo").fill(series.ticker);
  await recordDialog.getByLabel("Quantidade").fill("100");
  await recordDialog.getByLabel("Preço").fill(series.close.replace(".", ","));
  await recordDialog.getByLabel("Data").fill(series.session);
  await recordDialog.getByRole("button", { name: "Registrar execução" }).click();
  await expect(recordDialog).not.toBeVisible();

  const pending = page.locator("section", { hasText: "Liquidação pendente" });
  await expect(pending.getByText(series.ticker)).toBeVisible();
  await pending.getByRole("button", { name: "Criar operação" }).click();
  await pending.getByRole("button", { name: "Revisar liquidação" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar liquidação" }).click();

  const operations = page.locator("section", { hasText: "Operações" }).first();
  await expect(operations.getByText("vencida")).toBeVisible();
  await expect(page.locator("section", { hasText: "Liquidação pendente" })).toHaveCount(0);
});
