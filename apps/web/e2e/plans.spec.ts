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
  // Exact match (the exit rule text "a perda chega a 50% da perda máxima" would otherwise also
  // match "Perda máxima"'s own substring).
  await expect(page.getByText("Perda máxima", { exact: true })).toBeVisible();
  await expect(page.getByText("Ganho máximo", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ordens" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Call de PETR4, strike R\$/ })).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Regras" })).toBeVisible();

  await page.getByRole("button", { name: "Salvar plano" }).click();
  await expect(page.getByText("Plano salvo.")).toBeVisible();

  // The saved plan's own analysis entry point (round 2 review): the dialog trigger appears next
  // to the save confirmation, and opening it offers to request a first analysis.
  await page.getByRole("button", { name: "Análise" }).click();
  await expect(page.getByRole("button", { name: "Pedir análise" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Saving a plan records its own "enter" decision in the same transaction (ADR-0079): the
  // portfolio row already shows it, no DecisionBar left to fill in.
  await page.getByRole("link", { name: "Ir para a carteira" }).click();
  await expect(page).toHaveURL(/\/carteira$/);
  const row = page.getByRole("row", { name: /PETR4/ });
  await expect(row).toBeVisible();
  await expect(row.getByText(/^Entrar · /)).toBeVisible();

  await page.goto("/diario");
  // Loosened from an exact match (round 2 review): the summary now carries a trailing price-
  // close clause with a live session date, so this asserts the stable prefix instead.
  await expect(
    page.getByText(
      /A Fetha montou essa Trava de alta com calls em PETR4 a partir da sugestão de hoje\./,
    ),
  ).toBeVisible();
});

// Ticket #380: the strike ← → buttons are the keyboard/phone alternative to dragging a handle
// on the payoff chart, mandatory rather than a fallback (the range input underneath answers the
// same step for a mouse or an arrow key). Scoped with `.first()` for strict mode: both of the
// spread's two call legs render their own "Aumentar o strike" button with the same label.
test("adjust a plan's strike with the keyboard buttons, see what changed, then save", async ({
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

  await page.goto(`/planos/novo?sugestao=${suggestionId ?? ""}`);
  await expect(page.getByRole("heading", { name: "Plano de operação" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ajustar o plano" })).toBeVisible();
  await expect(page.getByText("Nada mudou ainda.")).toBeVisible();

  const increaseStrike = page.getByRole("button", { name: "Aumentar o strike" }).first();
  await expect(increaseStrike).toBeEnabled();
  await increaseStrike.click();

  // "O que mudou" (what changed from Fetha's own plan) now lists the edit, and the reset button
  // to go back to Fetha's plan appears alongside it.
  await expect(page.getByText("Nada mudou ainda.")).toBeHidden();
  await expect(page.getByRole("button", { name: "Voltar ao plano da Fetha" })).toBeVisible();

  // Waits for the server's own reprice (ADR-0079 round 4: the client preview is never official)
  // to land before saving, so the save button carries the edited plan's own fingerprint.
  await expect(page.getByText("Reprecificando...")).toHaveCount(0);

  await page.getByRole("button", { name: "Salvar plano" }).click();
  await expect(page.getByText("Plano salvo.")).toBeVisible();
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
  await expect(page.getByText("Perda máxima", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ordens" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "PETR4" }).first()).toBeVisible();
});
