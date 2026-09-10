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

  // A risk profile is declared above, so the chip must not be visible even
  // before pricing (PR #76 round 2 item 11): a regression that always shows
  // it must fail this assertion, not just the inverse one in the other test.
  await expect(page.getByText("sem perfil de risco")).not.toBeVisible();

  await page.getByLabel("Estrutura").click();
  await page.getByRole("option", { name: "Collar" }).click();

  const underlyingField = page.getByLabel("Ativo-objeto");
  await underlyingField.fill("PETR4");
  await underlyingField.blur();

  // The picker lists every listed series, traded or not (#22); only a
  // series that actually carries a last price can be priced by the engine,
  // so the spec must not rely on `.first()` alone (#22 round 2 diagnosis).
  // Within the priceable options, each dropdown is still ordered by
  // ascending strike (LegsTable's stable sort), so the lowest-strike
  // priceable put (an OTM protective put, below spot) paired with the
  // highest-strike priceable call (an OTM covered call, above spot) is
  // both a realistic collar and the only pairing the catalog's
  // strikeRank ordering (put < call) can accept regardless of the day's
  // actual chain (defect found running this spec against preview: picking
  // the lowest strike for both legs can put the call under the put and
  // fail save-time structure validation even though pricing succeeds).
  await page.getByLabel("Instrumento 2").click();
  await page.getByRole("option").filter({ hasNotText: "sem negócios" }).first().click();
  await page.getByLabel("Instrumento 3").click();
  await page.getByRole("option").filter({ hasNotText: "sem negócios" }).last().click();

  await page.getByRole("button", { name: "Precificar" }).click();

  await expect(page.getByText("Prêmio líquido")).toBeVisible();
  await expect(page.getByRole("alert", { name: "Limite excedido" })).toContainText(
    "Limite excedido",
  );

  // Post-pricing too (the `pricing.notes` branch of the chip's own
  // visibility check, not just the pre-pricing `hasRiskProfile` one).
  await expect(page.getByText("sem perfil de risco")).not.toBeVisible();

  // The breach is re-confirmed against a fresh re-pricing before it is
  // ever persisted (round 2 item 3), but since the fresh breach set
  // matches the one the user is already looking at, the click that says
  // "record anyway" both re-prices and saves in one step (defect found in
  // E2E against preview: the two-step confirm must not make a breached
  // save unreachable).
  const recordAnyway = page.getByRole("button", { name: "Registrar mesmo assim" });
  await recordAnyway.click();
  await expect(page.getByText("Operação salva.")).toBeVisible();
});
