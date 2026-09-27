import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";
import { readLatestLink } from "./support";

// Runs by hand against a Vercel preview deployment (see apps/web/e2e/README.md):
//   E2E_SECRET=... E2E_OWNER_EMAIL=... PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app \
//   pnpm --filter @fetha/web test:e2e
// The manual trigger moved from a CRON_SECRET bearer to the owner's own
// session (#51, docs/adr/0042): E2E_OWNER_EMAIL is a pre-provisioned,
// verified account already on the preview's OWNER_EMAILS allowlist.
const e2eSecret = process.env.E2E_SECRET;
const ownerEmail = process.env.E2E_OWNER_EMAIL;

test.skip(
  !e2eSecret || !ownerEmail,
  "E2E_SECRET or E2E_OWNER_EMAIL is not set; skipping the manual ingestion trigger.",
);

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
  const secret: string = e2eSecret ?? "";
  const email: string = ownerEmail ?? "";

  await page.goto("/link-magico");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link mágico" }).click();
  await expect(page).toHaveURL(/\/link-magico\/verifique\?email=/);

  const magicLink = await readLatestLink(request, baseURL, email, secret);
  await page.goto(magicLink);
  await expect(page).toHaveURL(baseURL ?? "/");

  await page.goto("/configuracoes");
  await expect(page.getByRole("heading", { name: "Disparo manual da ingestão" })).toBeVisible();

  await page.getByLabel("Sessão (opcional)").fill("2026-09-08");
  await page.getByRole("button", { name: "Rodar ingestão agora" }).click();

  await expect(page.getByText("Concluída")).toBeVisible();
  await expect(page.getByText(/Sessão: 2026-09-08/)).toBeVisible();
});
