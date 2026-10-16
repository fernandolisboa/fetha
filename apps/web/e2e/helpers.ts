import path from "node:path";

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { confirmEmailAndSetPassword, readLatestLink, signUp } from "./support";
import { closeTourOnceShown, skipTourWhenShown } from "./tour";

export const password = "correct-horse-battery-staple";

// CI seeds this account into fetha-preview after every reset
// (scripts/seed-e2e-owner.mjs, docs/adr/0042); the preview's OWNER_EMAILS
// names it.
export const ownerEmail = process.env.E2E_OWNER_EMAIL || "dono-e2e@example.com";

export async function registerAndSignIn(
  page: Page,
  request: APIRequestContext,
  baseURL: string | undefined,
  secret: string,
  { tour }: { tour: "skip" | "keep" } = { tour: "skip" },
): Promise<string> {
  const email = `fetha-e2e-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`;
  const name = "Playwright User";

  await signUp(page, { name, email });

  const link = await readLatestLink(request, baseURL, email, secret);
  await confirmEmailAndSetPassword(page, link, password, baseURL, name);

  if (tour === "skip") {
    await closeTourOnceShown(page);
  }

  return email;
}

// The nightly job's manual trigger runs for up to 300s (the same budget the
// cron route and /configuracoes's own `maxDuration` share); the default 30s
// test timeout and 5s expect timeout are both too short for it.
const NIGHTLY_JOB_TIMEOUT_MS = 300_000;
export const TEST_TIMEOUT_MS = NIGHTLY_JOB_TIMEOUT_MS + 60_000;
const SUITE_SOURCES = ["calendar", "cotahist", "instruments"];

// The owner signs in once per run, in owner.setup.ts, and every spec that
// needs the nightly job re-run opens a context from that saved session: one
// owner magic link per run instead of one per spec keeps the suite under the
// per-account limit on `/sign-in/magic-link` (3 per 60s, auth/options.ts).
export const ownerStorageState = path.join(__dirname, ".auth", "owner.json");

// The nightly job's manual trigger moved from a `CRON_SECRET` bearer to the
// owner's own session (#51, docs/adr/0042). This drives `/configuracoes`'s
// trigger form in a separate browser context, so the caller's own context
// and session are left untouched.
export async function triggerIngestionAsOwner(
  browser: Browser,
  baseURL: string | undefined,
  session: string,
): Promise<void> {
  test.setTimeout(TEST_TIMEOUT_MS);

  // `browser.newContext()` does not inherit `use.extraHTTPHeaders` from
  // playwright.config.ts (only the `page`/`request` fixtures do): every
  // preview run needs the Vercel Deployment Protection bypass header on
  // this separate context too, or it hits the SSO challenge page instead of
  // the app.
  const extraHTTPHeaders = test.info().project.use.extraHTTPHeaders;
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders,
    storageState: ownerStorageState,
  });
  const page = await context.newPage();
  await skipTourWhenShown(page);

  await runIngestion(page, session);

  await context.close();
}

export async function runIngestion(page: Page, session: string): Promise<void> {
  await page.goto("/configuracoes/administracao");
  await expect(page.getByRole("heading", { name: "Disparo manual da ingestão" })).toBeVisible();
  await page.getByLabel("Sessão (opcional)").fill(session);
  await page.getByRole("button", { name: "Rodar ingestão agora" }).click();
  // Waits on the result panel itself first, so a failed/busy/forbidden run
  // fails here instead of burning the full 300s budget on a missing source.
  await expect(page.getByRole("heading", { name: "Última execução" })).toBeVisible({
    timeout: NIGHTLY_JOB_TIMEOUT_MS,
  });
  // Asserts the sources the suite reads, not the whole run's "Concluída": the
  // Bacen SGS and IV index sources feed no spec, and SGS often fails on
  // Bacen's side (#289). The job itself gates evaluation on cotahist alone.
  for (const source of SUITE_SOURCES) {
    await expect(
      page.getByRole("listitem").filter({ hasText: new RegExp(`^${source}:`) }),
    ).toHaveText(new RegExp(`^${source}: (ok|pulada)$`));
  }
}
