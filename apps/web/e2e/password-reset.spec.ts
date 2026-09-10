import { expect, test } from "@playwright/test";

import { readLatestLink, throttleSignUp } from "./support";

// Runs by hand against a Vercel preview deployment (see apps/web/e2e/README.md):
//   E2E_SECRET=... PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app pnpm --filter @fetha/web test:e2e
// Requires REGISTRATION_MODE=open on that deployment (or a matching invite),
// since the flow registers a brand-new account end to end before resetting
// its password.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the password reset flow against a preview.");

test("password reset lets the user sign in with a new password", async ({
  page,
  baseURL,
  request,
}) => {
  const email = `fetha-e2e-password-reset-${String(Date.now())}@example.com`;
  const secret: string = e2eSecret ?? "";
  const oldPassword = "correct-horse-battery-staple";
  const newPassword = "another-correct-horse-battery";

  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill("Password Reset User");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(oldPassword);
  await page.getByRole("checkbox", { name: /Aceito os termos de uso/ }).check();
  await page.getByRole("checkbox", { name: /Aceito a política de privacidade/ }).check();
  await throttleSignUp();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/verificar-email\?email=/);

  const verificationLink = await readLatestLink(request, baseURL, email, secret);
  await page.goto(verificationLink);
  await expect(page.getByText("E-mail confirmado")).toBeVisible();

  await page.goto("/redefinir-senha");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link de redefinição" }).click();
  await expect(page).toHaveURL(/\/redefinir-senha\/verifique\?email=/);

  const resetCallbackLink = await readLatestLink(request, baseURL, email, secret);
  await page.goto(resetCallbackLink);
  await expect(page).toHaveURL(/\/redefinir-senha\/confirmar\?token=/);

  await page.getByLabel("Nova senha").fill(newPassword);
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(page).toHaveURL(/\/entrar/);

  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(oldPassword);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();

  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(newPassword);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(baseURL ?? "/");
  await expect(page.getByText(email)).toBeVisible();
});
