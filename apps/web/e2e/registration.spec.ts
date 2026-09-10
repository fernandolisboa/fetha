import { expect, test } from "@playwright/test";

import { readLatestLink } from "./support";

// Runs by hand against a Vercel preview deployment (see apps/web/e2e/README.md):
//   E2E_SECRET=... PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app pnpm --filter @fetha/web test:e2e
// Requires REGISTRATION_MODE=open on that deployment (or a matching invite),
// since the flow registers a brand-new account end to end.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the registration flow against a preview.");

test("registration, email verification, login and logout", async ({ page, baseURL, request }) => {
  const email = `fetha-e2e-${String(Date.now())}@example.com`;
  const secret: string = e2eSecret ?? "";

  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill("Playwright User");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("correct-horse-battery-staple");
  await page.getByRole("checkbox", { name: /Aceito os termos de uso/ }).check();
  await page.getByRole("checkbox", { name: /Aceito a política de privacidade/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page).toHaveURL(/\/verificar-email\?email=/);

  const link = await readLatestLink(request, baseURL, email, secret);

  await page.goto(link);
  await expect(page.getByText("E-mail confirmado")).toBeVisible();

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
