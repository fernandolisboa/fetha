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
const TEST_TIMEOUT_MS = NIGHTLY_JOB_TIMEOUT_MS + 60_000;

// Owner magic-link requests share a per-account rate limit (3 per 60s,
// auth/options.ts's "/sign-in/magic-link" rule), but a 429 never reaches this
// helper: the sign-in form stays on `/link-magico` on a rate-limited submit,
// so the caller's own `toHaveURL(/\/link-magico\/verifique/)` assertion
// fails first. What this guards against instead is mail-outbox lag: sending
// succeeded and a new row is on its way into `mail_outbox`, but reading the
// "latest" link right after the click can still race that write and return
// the *previous* email actually delivered — either a stale one this process
// already consumed, or a leftover one that predates this whole test run.
// Seeding the memo from the pre-click state (`seedMagicLinkBaseline`, a read
// only, never another send) and polling until it changes makes the guard
// correct even on a caller's first-ever read for an email, not just its own
// second one. Exported so every owner magic-link read in the suite shares
// the one memo.
const lastMagicLinkByEmail = new Map<string, string>();
const MAGIC_LINK_RETRY_TIMEOUT_MS = 20_000;
const MAGIC_LINK_RETRY_INTERVAL_MS = 1_000;

async function tryReadLatestLink(
  request: APIRequestContext,
  baseURL: string | undefined,
  email: string,
  secret: string,
): Promise<string | undefined> {
  const response = await request.get(
    `${baseURL ?? ""}/api/e2e/verification-link?email=${encodeURIComponent(email)}`,
    { headers: { "x-e2e-secret": secret } },
  );
  if (!response.ok()) {
    return undefined;
  }
  const { link } = (await response.json()) as { link: string };
  return link;
}

export async function seedMagicLinkBaseline(
  request: APIRequestContext,
  baseURL: string | undefined,
  email: string,
  secret: string,
): Promise<void> {
  const current = await tryReadLatestLink(request, baseURL, email, secret);
  if (current !== undefined) {
    lastMagicLinkByEmail.set(email, current);
  }
}

export async function readNewMagicLink(
  request: APIRequestContext,
  baseURL: string | undefined,
  email: string,
  secret: string,
): Promise<string> {
  const previous = lastMagicLinkByEmail.get(email);
  const deadline = Date.now() + MAGIC_LINK_RETRY_TIMEOUT_MS;
  let link = await readLatestLink(request, baseURL, email, secret);
  while (link === previous && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, MAGIC_LINK_RETRY_INTERVAL_MS));
    link = await readLatestLink(request, baseURL, email, secret);
  }
  if (link === previous) {
    throw new Error(`magic link for ${email} did not arrive; mail-outbox lag exceeded 20s`);
  }
  lastMagicLinkByEmail.set(email, link);
  return link;
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
  test.setTimeout(TEST_TIMEOUT_MS);

  // `browser.newContext()` does not inherit `use.extraHTTPHeaders` from
  // playwright.config.ts (only the `page`/`request` fixtures do): every
  // preview run needs the Vercel Deployment Protection bypass header on
  // this separate context too, or it hits the SSO challenge page instead of
  // the app.
  const extraHTTPHeaders = test.info().project.use.extraHTTPHeaders;
  const context = await browser.newContext({ baseURL, extraHTTPHeaders });
  const page = await context.newPage();
  await skipTourWhenShown(page);

  await page.goto(`${baseURL ?? ""}/link-magico`);
  await seedMagicLinkBaseline(context.request, baseURL, ownerEmail, e2eSecret);
  await page.getByLabel("E-mail").fill(ownerEmail);
  await page.getByRole("button", { name: "Enviar link mágico" }).click();
  await expect(page).toHaveURL(/\/link-magico\/verifique\?email=/);

  const magicLink = await readNewMagicLink(context.request, baseURL, ownerEmail, e2eSecret);
  await page.goto(magicLink);
  await expect(page).toHaveURL(baseURL ?? "/");

  await page.goto(`${baseURL ?? ""}/configuracoes`);
  await page.getByLabel("Sessão (opcional)").fill(session);
  await page.getByRole("button", { name: "Rodar ingestão agora" }).click();
  // Waits on the result panel itself, not the "Concluída" text: that text
  // only ever renders on the ok status, so a failed/busy/forbidden run would
  // otherwise burn the full 300s budget before failing.
  await expect(page.getByRole("heading", { name: "Última execução" })).toBeVisible({
    timeout: NIGHTLY_JOB_TIMEOUT_MS,
  });
  await expect(page.getByText("Concluída")).toBeVisible();

  await context.close();
}
