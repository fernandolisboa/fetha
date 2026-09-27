import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { confirmEmailAndSetPassword, readLatestLink, signUp } from "./support";

export const password = "correct-horse-battery-staple";

export async function registerAndSignIn(
  page: Page,
  request: APIRequestContext,
  baseURL: string | undefined,
  secret: string,
): Promise<string> {
  const email = `fetha-e2e-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`;
  const name = "Playwright User";

  await signUp(page, { name, email });

  const link = await readLatestLink(request, baseURL, email, secret);
  await confirmEmailAndSetPassword(page, link, password, baseURL, name);

  return email;
}

// The nightly job's manual trigger moved from a `CRON_SECRET` bearer to the
// owner's own session (#51, docs/adr/0042): specs that only need a session
// re-ingested before their own flow (signals, decisions, scoring, backtest,
// compare) open a separate browser context, sign the pre-provisioned owner
// account in through a magic link (never a password this spec doesn't know)
// and drive `/configuracoes`'s trigger form, so the caller's own context and
// session are left untouched.
export async function triggerIngestionAsOwner(
  browser: Browser,
  baseURL: string | undefined,
  e2eSecret: string,
  session: string,
): Promise<void> {
  const ownerEmail = process.env.E2E_OWNER_EMAIL;
  if (!ownerEmail) {
    throw new Error("E2E_OWNER_EMAIL is not set");
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${baseURL ?? ""}/link-magico`);
  await page.getByLabel("E-mail").fill(ownerEmail);
  await page.getByRole("button", { name: "Enviar link mágico" }).click();
  await expect(page).toHaveURL(/\/link-magico\/verifique\?email=/);

  const magicLink = await readLatestLink(context.request, baseURL, ownerEmail, e2eSecret);
  await page.goto(magicLink);
  await expect(page).toHaveURL(baseURL ?? "/");

  await page.goto(`${baseURL ?? ""}/configuracoes`);
  await page.getByLabel("Sessão (opcional)").fill(session);
  await page.getByRole("button", { name: "Rodar ingestão agora" }).click();
  await expect(page.getByText("Concluída")).toBeVisible();

  await context.close();
}
