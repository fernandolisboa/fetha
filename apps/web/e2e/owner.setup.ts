import type { APIRequestContext } from "@playwright/test";

import { expect, skipTourWhenShown, test as setup } from "./tour";

import { ownerEmail, ownerStorageState, runIngestion, TEST_TIMEOUT_MS } from "./helpers";
import { REFERENCE_SESSIONS } from "./sessions";
import { openMagicLink, requestMagicLink } from "./support";

// Runs before every other project (playwright.config.ts). CI resets the
// preview database before each run and seeds no market data, so this signs
// the CI-seeded owner in once (scripts/seed-e2e-owner.mjs, docs/adr/0042),
// saves that session for the specs that re-run the nightly job, and ingests
// every session the suite reads, instead of each spec relying on another
// one's ingestion having run first.
const e2eSecret = process.env.E2E_SECRET;

setup.skip(!e2eSecret, "E2E_SECRET is not set; no owner session or market data to set up.");

async function latestLinkFor(
  request: APIRequestContext,
  email: string,
): Promise<string | undefined> {
  const response = await request.get(
    `/api/e2e/verification-link?email=${encodeURIComponent(email)}`,
    { headers: { "x-e2e-secret": e2eSecret ?? "" } },
  );
  if (!response.ok()) {
    return undefined;
  }
  return ((await response.json()) as { link: string }).link;
}

setup("sign the owner in", async ({ page, request, baseURL }) => {
  // Reading a captured link also deletes it (auth/verification-link.ts), so
  // this first read drains a link an earlier run left behind, and the poll
  // then waits for this run's own link to reach the outbox.
  await latestLinkFor(request, ownerEmail);
  await requestMagicLink(page, ownerEmail);
  let link: string | undefined;
  await expect
    .poll(async () => (link = await latestLinkFor(request, ownerEmail)), { timeout: 20_000 })
    .toBeDefined();

  await openMagicLink(page, link ?? "");
  await expect(page).toHaveURL(baseURL ?? "/");
  await page.context().storageState({ path: ownerStorageState });
});

setup("ingest the sessions the suite reads", async ({ browser, baseURL }) => {
  setup.setTimeout(TEST_TIMEOUT_MS * REFERENCE_SESSIONS.length);

  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: setup.info().project.use.extraHTTPHeaders,
    storageState: ownerStorageState,
  });
  const page = await context.newPage();
  await skipTourWhenShown(page);
  for (const session of REFERENCE_SESSIONS) {
    await runIngestion(page, session);
  }
  await context.close();
});
