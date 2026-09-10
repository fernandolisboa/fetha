import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
// PETR4's daily closing chain is ingested reference data (#12): this spec
// depends on it having at least one put and one call series, which nightly
// ingestion guarantees for a liquid underlying like PETR4.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the operation builder flow.");

test("prices without a risk profile and shows the chip linking to settings", async ({
  page,
  request,
  baseURL,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.goto("/carteira/nova-operacao");
  await page.getByLabel("Estrutura").click();
  await page.getByRole("option", { name: "Compra de ação" }).click();

  const underlyingField = page.getByLabel("Ativo-objeto");
  await underlyingField.fill("PETR4");
  await underlyingField.blur();

  const chip = page.getByText("sem perfil de risco");
  await expect(chip).toBeVisible();

  await page.getByRole("button", { name: "Precificar" }).click();
  await expect(page.getByText("Prêmio líquido")).toBeVisible();
  await expect(page.getByText("sem perfil de risco")).toBeVisible();

  await chip.locator("xpath=ancestor::a").click();
  await expect(page).toHaveURL(/\/configuracoes$/);
});

test("build a collar on PETR4, see the breach warning, and save it", async ({
  page,
  request,
  baseURL,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  // A tiny declared capital against real premiums guarantees the collar
  // breaches maxExposurePerOperation, so the RiskNotice is deterministic
  // regardless of the day's actual PETR4 price.
  await page.goto("/configuracoes");
  await page.getByLabel("Capital declarado").fill("100,00");
  await page.getByLabel("Perda máxima por operação").fill("2");
  await page.getByLabel("Exposição máxima por operação").fill("1");
  await page.getByLabel("Máximo de operações abertas").fill("5");
  await page.getByLabel("Prêmio máximo comprado em opções").fill("5");
  await page.getByRole("button", { name: "Salvar perfil de risco" }).click();
  await expect(page.getByText("Perfil de risco salvo.")).toBeVisible();

  await page.goto("/carteira/nova-operacao");
  await page.getByLabel("Estrutura").click();
  await page.getByRole("option", { name: "Collar" }).click();

  const underlyingField = page.getByLabel("Ativo-objeto");
  await underlyingField.fill("PETR4");
  await underlyingField.blur();

  await page.getByLabel("Instrumento 2").click();
  await page.getByRole("option").first().click();
  await page.getByLabel("Instrumento 3").click();
  await page.getByRole("option").first().click();

  await page.getByRole("button", { name: "Precificar" }).click();

  await expect(page.getByText("Prêmio líquido")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Limite excedido");

  await page.getByRole("button", { name: "Registrar mesmo assim" }).click();
  await expect(page.getByText("Operação salva.")).toBeVisible();
});
