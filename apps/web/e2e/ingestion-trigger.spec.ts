import { expect, test } from "./tour";

import { ownerStorageState, registerAndSignIn, runIngestion, TEST_TIMEOUT_MS } from "./helpers";
import { FROM_SESSION } from "./sessions";

// Runs by hand against a Vercel preview deployment (see apps/web/e2e/README.md):
//   E2E_SECRET=... PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app \
//   pnpm --filter @fetha/web test:e2e
// The manual trigger moved from a CRON_SECRET bearer to the owner's own
// session (#51, docs/adr/0042): owner.setup.ts signs in the account CI seeds
// after every preview reset, already on the preview's OWNER_EMAILS allowlist.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the manual ingestion trigger.");

test("a non-owner account never sees the manual ingestion trigger", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.goto("/configuracoes/conta");
  await expect(page.getByRole("tab", { name: "Administração" })).toHaveCount(0);

  await page.goto("/configuracoes/administracao");
  await expect(page.getByRole("heading", { name: "Disparo manual da ingestão" })).not.toBeVisible();
});

test.describe("as the owner", () => {
  test.use({ storageState: ownerStorageState });

  test("the owner's manual ingestion trigger runs for a given session", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS);

    await page.goto("/configuracoes/administracao");
    await expect(page.getByRole("heading", { name: "Disparo manual da ingestão" })).toBeVisible();

    await runIngestion(page, FROM_SESSION);
    await expect(page.getByText(/Sessão: 08\/09\/2026/)).toBeVisible();
  });
});
