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
  const summary = page.getByTestId("research-summary");
  await expect(summary).toContainText(/Olhei \d+ ideias? de \d+ preg(ão|ões)/);
  await expect(summary).toContainText("sem dados para avaliar a regra hoje");
  const research = page.getByTestId("research-result");
  await expect(research.getByText("Deixaram de valer")).toHaveCount(0);
  // The owner has no Anthropic key: the engine's result stays and one line says why Fetha is
  // silent (docs/adr/0076).
  const notice = page.getByTestId("research-notice");
  await expect(notice).toContainText(
    "Para o Fetha opinar sobre as ideias, cadastre a sua chave da Anthropic em",
  );
  await expect(notice.getByRole("link", { name: "Configurações › IA" })).toHaveAttribute(
    "href",
    "/configuracoes/ia",
  );
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

test("a stored research shows on load, grouped by verdict, with the discarded ones collapsed", async ({
  page,
  baseURL,
  request,
}) => {
  test.setTimeout(90_000);

  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");
  const seeded = await page.request.post("/api/e2e/seed-research", {
    headers: { "x-e2e-secret": e2eSecret ?? "" },
  });
  expect(seeded.status()).toBe(201);

  await page.goto("/");
  const research = page.getByTestId("research-result");
  await expect(research.getByTestId("research-stamp")).toContainText(
    /^Pesquisa de \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2} · Claude Opus 5\.5$/,
  );
  await expect(research.getByTestId("research-overview")).toContainText("Pesquisa semeada");
  await expect(page.getByRole("button", { name: "Pesquisar de novo" })).toBeEnabled();

  await expect(research.getByRole("region", { name: "Vale a pena" })).toBeVisible();
  await expect(
    research.getByRole("article", { name: "Eu entraria: Trava de alta com calls em PETR4." }),
  ).toBeVisible();
  await expect(research.getByRole("region", { name: "Com ressalva" })).toBeVisible();
  await expect(
    research.getByRole("article", { name: "Eu esperaria: Trava de alta com calls em PETR4." }),
  ).toBeVisible();

  const discarded = research.getByTestId("research-discarded");
  const toggle = discarded.getByRole("button", { name: "1 ideia descartada, ver por quê" });
  await expect(toggle).toBeVisible();
  await expect(discarded.getByRole("article")).toHaveCount(0);
  await toggle.click();
  const verdictCard = discarded.getByRole("article", {
    name: "Eu não entraria: Trava de alta com calls em PETR4.",
  });
  await expect(verdictCard).toBeVisible();
  await expect(verdictCard.getByTestId("research-ai-alert").first()).toBeVisible();

  const worth = research.getByRole("article", {
    name: "Eu entraria: Trava de alta com calls em PETR4.",
  });
  await expect(worth.getByRole("link", { name: "Montar no simulador" })).toHaveAttribute(
    "href",
    /\/carteira\/nova-operacao\?pesquisa=.+/,
  );
  await worth.getByRole("button", { name: "Registrar decisão" }).click();
  const dialog = page.getByRole("dialog", { name: "Registrar decisão" });
  await dialog.getByRole("button", { name: "Entrar", exact: true }).click();
  await dialog.getByLabel("Justificativa").fill("Decisão sobre uma ideia da pesquisa do Fetha");
  await dialog.getByLabel("Confiança (%)").fill("60");
  await dialog.getByLabel("Horizonte").fill("2030-01-01");
  await dialog.getByRole("button", { name: "Salvar decisão" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(worth.getByTestId("research-decision")).toContainText("Sua decisão: Entrar");

  await page.goto("/diario");
  await expect(page.getByText(/Pesquisa do Fetha · /).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pesquisas do Fetha" })).toBeVisible();
  await expect(page.getByTestId("research-calibration-empty")).toBeVisible();
});

test("choose when seen suggestions leave today's suggestions", async ({
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

  await page.goto("/");
  const setting = page.getByTestId("suggestion-archive-setting");
  await expect(setting).toContainText("As sugestões que você já viu continuam aqui.");
  await setting.getByRole("link", { name: "Ajustar" }).click();

  await expect(page).toHaveURL(/\/configuracoes\/aparencia#sugestoes$/);
  const toggle = page.getByRole("switch", { name: "Arquivar as sugestões que eu já vi" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByTestId("suggestion-archive-example")).toContainText("Sai do quadro");

  const amount = page.getByRole("textbox", { name: "Quantos" });
  await amount.fill("90");
  await page.getByRole("combobox", { name: "Unidade" }).click();
  await page.getByRole("option", { name: "minutos" }).click();
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Salvo." })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Quantos" })).toHaveValue("90");
  await expect(page.getByRole("combobox", { name: "Unidade" })).toHaveText(/minutos/);

  await page.getByRole("button", { name: "1 dia" }).click();
  await expect(page.getByRole("button", { name: "1 dia" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Arquivar as sugestões que eu já vi" }),
  ).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Quantos" })).toHaveValue("1");

  await page.goto("/");
  await expect(page.getByTestId("today-suggestions").getByRole("article").first()).toBeVisible();
  await expect(page.getByTestId("suggestion-archive-setting")).toContainText(
    "As sugestões que você já viu saem daqui 1 dia depois da primeira vez.",
  );
});
