import { readFile } from "node:fs/promises";

import { expect, test } from "./tour";

import { password, registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the account data flows.");

test("export my data as a JSON file", async ({ page, baseURL, request }) => {
  const email = await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.goto("/configuracoes");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Exportar meus dados" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^fetha-dados-\d{4}-\d{2}-\d{2}\.json$/);
  const document = JSON.parse(await readFile(await download.path(), "utf8")) as {
    format: string;
    tables: Record<string, Record<string, unknown>[]>;
  };
  expect(document.format).toBe("fetha-export/1");
  expect(document.tables.user).toEqual([expect.objectContaining({ email })]);

  await page.reload();
  await expect(page.getByRole("cell", { name: "Exportação dos dados" })).toBeVisible();
});

test("delete my account and every piece of its data", async ({ page, baseURL, request }) => {
  const email = await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.goto("/configuracoes");
  await page.getByRole("button", { name: "Excluir minha conta" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Senha").fill("not-the-password");
  await dialog.getByRole("button", { name: "Excluir conta" }).click();
  await expect(dialog.getByText("Senha incorreta.")).toBeVisible();

  await dialog.getByLabel("Senha").fill(password);
  await dialog.getByRole("button", { name: "Excluir conta" }).click();
  await expect(page).toHaveURL(/\/conta-excluida$/);
  await expect(page.getByRole("heading", { name: "Conta excluída" })).toBeVisible();

  await page.goto("/configuracoes");
  await expect(page).toHaveURL(/\/entrar/);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
});
