import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { readLatestLink, signUp } from "./support";

// Runs by hand against a Vercel preview deployment (see apps/web/e2e/README.md):
//   E2E_SECRET=... PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app pnpm --filter @fetha/web test:e2e
// Requires REGISTRATION_MODE=open on that deployment (or a matching invite),
// since the flow registers a brand-new account end to end.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the registration flow against a preview.");

test("registration, email verification, login and logout", async ({ page, baseURL, request }) => {
  const email = `fetha-e2e-${String(Date.now())}@example.com`;
  const name = "Playwright User";
  const secret: string = e2eSecret ?? "";

  await signUp(page, { name, email });

  const link = await readLatestLink(request, baseURL, email, secret);

  // Verification clears the sign-up consent (docs/adr/0028's residual,
  // closed by docs/adr/0036), so every new registrant lands on the
  // "unconfirmed" state of the re-acceptance gate here. Security audit C-06:
  // export and account deletion must stay available without accepting
  // first, so this drives the gate by hand instead of the shared
  // `confirmEmailAndSetPassword` helper, to check both before accepting.
  await page.goto(link);
  await expect(page).toHaveURL(/\/definir-senha/);
  await page.getByLabel("Senha").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Salvar senha" }).click();
  await expect(page).toHaveURL(/\/aceitar-termos/);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Exportar meus dados" }).click();
  const download = await downloadPromise;
  const exportDocument = JSON.parse(await readFile(await download.path(), "utf8")) as {
    format: string;
  };
  expect(exportDocument.format).toBe("fetha-export/1");

  await page.getByRole("button", { name: "Excluir minha conta" }).click();
  const deleteDialog = page.getByRole("dialog");
  await expect(
    deleteDialog.getByRole("heading", { name: "Excluir sua conta de vez?" }),
  ).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(deleteDialog).toBeHidden();

  // Nothing above accepted the terms; the page is still on the gate.
  await expect(page).toHaveURL(/\/aceitar-termos/);
  await page.getByLabel("Nome").fill(name);
  await page.getByRole("checkbox", { name: /Aceito os termos de uso/ }).check();
  await page.getByRole("checkbox", { name: /Aceito a política de privacidade/ }).check();
  await page.getByRole("button", { name: "Aceitar e continuar" }).click();
  await expect(page).toHaveURL(baseURL ?? "/");

  await page.getByRole("button", { name: "Menu da conta" }).click();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar/);

  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL(baseURL ?? "/");
  const accountMenuTrigger = page.getByRole("button", { name: "Menu da conta" });
  await expect(accountMenuTrigger).toContainText(email);
  await accountMenuTrigger.click();

  await page.getByRole("button", { name: "Sair" }).click();

  await expect(page).toHaveURL(/\/entrar/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/entrar/);
});
