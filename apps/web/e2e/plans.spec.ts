import { expect, test } from "./tour";

import { registerAndSignIn } from "./helpers";

// Same seed as radar.spec.ts and suggestions.spec.ts (#379): one PETR4 bull call spread
// suggestion at the newest ingested close.
const e2eSecret = process.env.E2E_SECRET;
const HEADLINE = "Uma trava de alta com calls em PETR4 cabe agora.";

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the plan flow.");

test("build a plan from a suggestion, save it, and decide on it from the portfolio", async ({
  page,
  baseURL,
  request,
}) => {
  test.setTimeout(90_000);

  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const seeded = await page.request.post("/api/e2e/seed-radar", {
    headers: { "x-e2e-secret": e2eSecret ?? "" },
  });
  expect(seeded.status()).toBe(201);
  const { suggestionId } = (await seeded.json()) as { suggestionId: string | null };
  expect(suggestionId, "the engine should price the seeded spread").toBeTruthy();

  await page.goto("/");
  const panel = page.getByTestId("today-suggestions");
  const card = panel.getByRole("article", { name: HEADLINE });
  await expect(card).toBeVisible();

  await card.getByRole("link", { name: "Montar plano" }).click();
  await expect(page).toHaveURL(new RegExp(`/planos/novo\\?sugestao=${suggestionId ?? ""}$`));

  await expect(page.getByRole("heading", { name: "Plano de operação" })).toBeVisible();
  await expect(page.getByText("Perda máxima")).toBeVisible();
  await expect(page.getByText("Ganho máximo")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ordens" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Call de PETR4, strike R\$/ })).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Regras" })).toBeVisible();

  await page.getByRole("button", { name: "Salvar plano" }).click();
  await expect(page.getByText("Plano salvo.")).toBeVisible();

  // Saving a plan records its own "enter" decision in the same transaction (ADR-0079): the
  // portfolio row already shows it, no DecisionBar left to fill in.
  await page.getByRole("link", { name: "Ir para a carteira" }).click();
  await expect(page).toHaveURL(/\/carteira$/);
  const row = page.getByRole("row", { name: /PETR4/ });
  await expect(row).toBeVisible();
  await expect(row.getByText(/^Entrar · /)).toBeVisible();

  await page.goto("/diario");
  await expect(
    page.getByText(
      "A Fetha montou essa Trava de alta com calls em PETR4 a partir da sugestão de hoje.",
    ),
  ).toBeVisible();
});

test("build a plan from the asset page's own view question and see its orders", async ({
  page,
  baseURL,
  request,
}) => {
  test.setTimeout(90_000);

  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.goto("/ativos/PETR4");
  await expect(page.getByText("O que você espera de PETR4 nas próximas semanas?")).toBeVisible();
  await page.getByRole("radio", { name: "Sobe" }).click();
  await page.getByRole("button", { name: "Montar plano" }).click();

  await expect(page).toHaveURL(/\/planos\/novo\?ticker=PETR4&view=up$/);
  await expect(page.getByRole("heading", { name: "Plano de operação" })).toBeVisible();
  await expect(page.getByText("Perda máxima")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ordens" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "PETR4" }).first()).toBeVisible();
});
