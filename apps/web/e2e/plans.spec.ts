import { expect, test } from "./tour";

import { registerAndSignIn } from "./helpers";

// Same seed as radar.spec.ts and suggestions.spec.ts (#379): one PETR4 bull call spread
// suggestion at the newest ingested close.
const e2eSecret = process.env.E2E_SECRET;
const HEADLINE = "Uma trava de alta com calls em PETR4 cabe agora.";
const RATIONALE = "Plano montado no teste de ponta a ponta";

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

  await page.getByRole("link", { name: "Ir para a carteira" }).click();
  await expect(page).toHaveURL(/\/carteira$/);

  const row = page.getByRole("row", { name: /PETR4/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Registrar decisão" }).click();
  const dialog = page.getByRole("dialog", { name: "Registrar decisão" });
  await dialog.getByRole("button", { name: "Entrar", exact: true }).click();
  await dialog.getByLabel("Justificativa").fill(RATIONALE);
  await dialog.getByLabel("Confiança (%)").fill("60");
  await dialog.getByLabel("Horizonte").fill("2030-01-01");
  await dialog.getByRole("button", { name: "Salvar decisão" }).click();
  await expect(dialog).not.toBeVisible();

  await page.goto("/diario");
  await expect(page.getByText(RATIONALE)).toBeVisible();
});
