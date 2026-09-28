import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
// Imports Playwright's own `test`, not ./tour's: this spec is the one place
// the guided tour must stay on screen.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the guided tour flow.");

test("the tour starts on first sign-in, stays dismissed, and replays from the guide", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "", { tour: "keep" });

  const card = page.locator("[data-tour-card]");
  await expect(card.getByText("Boas-vindas à Fetha")).toBeVisible();
  await expect(card.getByText("Passo 1 de 8", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Próximo" }).click();
  await expect(card.getByText("Navegação")).toBeVisible();
  await card.getByRole("button", { name: "Voltar" }).click();
  await expect(card.getByText("Boas-vindas à Fetha")).toBeVisible();

  await Promise.all([
    page.waitForResponse((res) => res.request().method() === "POST"),
    card.getByRole("button", { name: "Pular tour" }).click(),
  ]);
  await expect(card).toBeHidden();

  await page.reload();
  // Opening the combobox needs a hydrated page, which is also when the tour
  // would have mounted.
  await page.getByRole("button", { name: "Adicionar ativo" }).click();
  await expect(page.getByPlaceholder("Buscar pelo código")).toBeVisible();
  await expect(card).toBeHidden();
  await page.keyboard.press("Escape");

  await page.goto("/como-usar");
  await page.getByRole("button", { name: "Refazer o tour" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(card.getByText("Passo 1 de 8", { exact: true })).toBeVisible();

  const titles = [
    "Navegação",
    "Comece pela watchlist",
    "Sinais",
    "Estratégias",
    "Carteira",
    "Diário",
    "Menu da conta",
  ];
  for (const [offset, title] of titles.entries()) {
    await card.getByRole("button", { name: "Próximo" }).click();
    await expect(card.getByText(`Passo ${String(offset + 2)} de 8`, { exact: true })).toBeVisible();
    await expect(card.getByRole("heading", { name: title })).toBeVisible();
  }
  await expect(card.getByRole("button", { name: "Pular tour" })).toBeHidden();
  await card.getByRole("button", { name: "Concluir" }).click();
  await expect(card).toBeHidden();
});

test("Escape skips the tour for good", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "", { tour: "keep" });

  const card = page.locator("[data-tour-card]");
  await expect(card.getByText("Passo 1 de 8", { exact: true })).toBeVisible();

  await Promise.all([
    page.waitForResponse((res) => res.request().method() === "POST"),
    page.keyboard.press("Escape"),
  ]);
  await expect(card).toBeHidden();

  await page.reload();
  await page.getByRole("button", { name: "Adicionar ativo" }).click();
  await expect(page.getByPlaceholder("Buscar pelo código")).toBeVisible();
  await expect(card).toBeHidden();
});
