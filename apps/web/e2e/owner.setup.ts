import { expect, skipTourWhenShown, test as setup } from "./tour";

import { ownerEmail, ownerStorageState, runIngestion, TEST_TIMEOUT_MS } from "./helpers";
import { FIXED_SESSIONS } from "./sessions";
import { openMagicLink, requestMagicLink, tryReadLatestLink } from "./support";

// Runs before every other project (playwright.config.ts). CI resets the
// preview database before each run and seeds no market data, so this signs
// the CI-seeded owner in once (scripts/seed-e2e-owner.mjs, docs/adr/0042),
// saves that session for the specs that re-run the nightly job, and ingests
// every session the suite reads, instead of each spec relying on another
// one's ingestion having run first.
const e2eSecret = process.env.E2E_SECRET;

setup.skip(!e2eSecret, "E2E_SECRET is not set; no owner session or market data to set up.");

setup("sign the owner in", async ({ page, request, baseURL }) => {
  setup.setTimeout(TEST_TIMEOUT_MS);
  const secret = e2eSecret ?? "";
  // Reading a captured link also deletes it, so this first read drains a
  // link an earlier run left behind, and the poll then waits for this run's
  // own link to reach the outbox.
  await tryReadLatestLink(request, baseURL, ownerEmail, secret);
  await requestMagicLink(page, ownerEmail);
  let link: string | undefined;
  await expect
    .poll(async () => (link = await tryReadLatestLink(request, baseURL, ownerEmail, secret)), {
      timeout: 20_000,
    })
    .toBeDefined();

  await openMagicLink(page, link ?? "");
  await expect(page).toHaveURL(baseURL ?? "/");
  await page.context().storageState({ path: ownerStorageState });
});

setup("ingest the fixed sessions the suite reads", async ({ browser, baseURL }) => {
  setup.setTimeout(TEST_TIMEOUT_MS * FIXED_SESSIONS.length);

  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: setup.info().project.use.extraHTTPHeaders,
    storageState: ownerStorageState,
  });
  const page = await context.newPage();
  await skipTourWhenShown(page);
  for (const session of FIXED_SESSIONS) {
    await runIngestion(page, session);
  }
  await context.close();
});
