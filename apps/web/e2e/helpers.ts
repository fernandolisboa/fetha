import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { readLatestLink, signUp } from "./support";

const password = "correct-horse-battery-staple";

export async function registerAndSignIn(
  page: Page,
  request: APIRequestContext,
  baseURL: string | undefined,
  secret: string,
): Promise<string> {
  const email = `fetha-e2e-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`;

  await signUp(page, { name: "Playwright User", email, password });

  const link = await readLatestLink(request, baseURL, email, secret);

  await page.goto(link);

  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(baseURL ?? "/");

  return email;
}
