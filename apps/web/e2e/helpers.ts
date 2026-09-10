import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { readLatestLink, throttleSignUp } from "./support";

const password = "correct-horse-battery-staple";

export async function registerAndSignIn(
  page: Page,
  request: APIRequestContext,
  baseURL: string | undefined,
  secret: string,
): Promise<string> {
  const email = `fetha-e2e-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`;

  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill("Playwright User");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("checkbox", { name: /Aceito os termos de uso/ }).check();
  await page.getByRole("checkbox", { name: /Aceito a política de privacidade/ }).check();
  await throttleSignUp();
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page).toHaveURL(/\/verificar-email\?email=/);

  const link = await readLatestLink(request, baseURL, email, secret);

  await page.goto(link);

  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(baseURL ?? "/");

  return email;
}
