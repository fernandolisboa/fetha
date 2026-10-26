import { expect, test } from "./tour";

import { registerAndSignIn } from "./helpers";

// The preview's radar finds nothing on its own (too little history), so `/api/e2e/seed-radar`
// files PETR4 under the bull call spread recipe at its newest close, with the suggestion the
// engine prices for one lot of it (docs/adr/0067).
const e2eSecret = process.env.E2E_SECRET;
const HEADLINE = "Uma trava de alta com calls em PETR4 cabe agora.";
const RATIONALE = "Sugestão do Fetha seguida no teste de ponta a ponta";

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the suggestions flow.");

test("see today's suggestion, open its recipe and record a decision on it", async ({
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
  await expect(card.getByRole("list", { name: "O lote" })).toContainText("100 ×");
  await expect(card.getByText(/^A tese: /)).toBeVisible();

  // The preview holds a few sessions, far short of the history the recipe's rule reads, so the
  // engine cannot evaluate it: the idea is dropped as not evaluable, never called stale.
  await page.getByRole("button", { name: "Obter sugestões" }).click();
  const research = page.getByTestId("research-result");
  await expect(research).toContainText(/Olhei \d+ ideias? de \d+ preg(ão|ões)/);
  await expect(research).toContainText("sem dados para avaliar a regra hoje");
  await expect(research.getByText("Deixaram de valer")).toHaveCount(0);
  await expect(
    research.getByRole("link", { name: "Declare o seu em Configurações" }),
  ).toBeVisible();

  await card.getByRole("link", { name: "Ver receita" }).click();
  await expect(page).toHaveURL(new RegExp(`/sugestoes/${suggestionId ?? ""}$`));
  await expect(page.getByRole("heading", { name: HEADLINE })).toBeVisible();
  await expect(page.getByTestId("recipe-rule")).toBeVisible();
  await expect(page.getByText("Em aberto", { exact: true })).toBeVisible();

  const onPage = page.getByRole("article", { name: HEADLINE });
  await onPage.getByRole("button", { name: "Registrar decisão" }).click();
  const dialog = page.getByRole("dialog", { name: "Registrar decisão" });
  await dialog.getByRole("button", { name: "Entrar", exact: true }).click();
  await dialog.getByLabel("Justificativa").fill(RATIONALE);
  await dialog.getByLabel("Confiança (%)").fill("60");
  await dialog.getByLabel("Horizonte").fill("2030-01-01");
  await dialog.getByRole("button", { name: "Salvar decisão" }).click();

  await expect(dialog).not.toBeVisible();
  await expect(onPage.getByTestId("suggestion-decision")).toContainText("Sua decisão: Entrar");

  await page.goto("/diario");
  await expect(page.getByText(RATIONALE)).toBeVisible();
  await expect(page.getByText(/Sugestão do Fetha · /).first()).toBeVisible();
});
