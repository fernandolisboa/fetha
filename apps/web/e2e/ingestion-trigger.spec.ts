import { expect, test } from "./tour";

import { ownerEmail, readNewMagicLink, registerAndSignIn, seedMagicLinkBaseline } from "./helpers";

// Runs by hand against a Vercel preview deployment (see apps/web/e2e/README.md):
//   E2E_SECRET=... PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app \
//   pnpm --filter @fetha/web test:e2e
// The manual trigger moved from a CRON_SECRET bearer to the owner's own
// session (#51, docs/adr/0042): `ownerEmail` is the account CI seeds after
// every preview reset, already on the preview's OWNER_EMAILS allowlist.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the manual ingestion trigger.");

test("a non-owner account never sees the manual ingestion trigger", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.goto("/configuracoes");
  await expect(page.getByRole("heading", { name: "Disparo manual da ingestão" })).not.toBeVisible();
});

test("the owner's manual ingestion trigger runs for a given session", async ({
  page,
  baseURL,
  request,
}) => {
  // The nightly job's own budget is 300s; the default 30s test timeout and
  // 5s expect timeout are both too short for it.
  test.setTimeout(360_000);

  const secret: string = e2eSecret ?? "";

  await page.goto("/link-magico");
  await seedMagicLinkBaseline(request, baseURL, ownerEmail, secret);
  await page.getByLabel("E-mail").fill(ownerEmail);
  await page.getByRole("button", { name: "Enviar link mágico" }).click();
  await expect(page).toHaveURL(/\/link-magico\/verifique\?email=/);

  const magicLink = await readNewMagicLink(request, baseURL, ownerEmail, secret);
  await page.goto(magicLink);
  await expect(page).toHaveURL(baseURL ?? "/");

  await page.goto("/configuracoes");
  await expect(page.getByRole("heading", { name: "Disparo manual da ingestão" })).toBeVisible();

  await page.getByLabel("Sessão (opcional)").fill("2026-09-08");
  await page.getByRole("button", { name: "Rodar ingestão agora" }).click();

  // Waits on the result panel itself, not the "Concluída" text: that text
  // only ever renders on the ok status, so a failed/busy/forbidden run would
  // otherwise burn the full 300s budget before failing.
  await expect(page.getByRole("heading", { name: "Última execução" })).toBeVisible({
    timeout: 300_000,
  });
  await expect(page.getByText("Concluída")).toBeVisible();
  await expect(page.getByText(/Sessão: 08\/09\/2026/)).toBeVisible();
});
