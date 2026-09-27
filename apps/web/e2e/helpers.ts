import type { APIRequestContext, Page } from "@playwright/test";

import { confirmEmailAndSetPassword, readLatestLink, signUp } from "./support";

export const password = "correct-horse-battery-staple";

export async function registerAndSignIn(
  page: Page,
  request: APIRequestContext,
  baseURL: string | undefined,
  secret: string,
): Promise<string> {
  const email = `fetha-e2e-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`;

  await signUp(page, { name: "Playwright User", email });

  const link = await readLatestLink(request, baseURL, email, secret);
  await confirmEmailAndSetPassword(page, link, password, baseURL);

  return email;
}
