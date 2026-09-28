import { expect, test } from "./tour";

import { registerAndSignIn, triggerIngestionAsOwner } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
// Seeds a thesis-only decision through the E2E-only `/api/e2e/seed-decision`
// route (backdated `decided_at` to the already-ingested session
// `2026-09-08`, horizon the *next* ingested session `2026-09-09` — no
// look-ahead), then triggers the owner's manual
// ingestion trigger (#51) — same one `signals.spec.ts` and
// `decisions.spec.ts` use — and confirms `/diario` shows the decision
// already scored, with its components (#29 acceptance criterion b), not
// "pendente".
const e2eSecret = process.env.E2E_SECRET;
const SESSION = "2026-09-09";

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the decision scoring flow.");

test("a seeded decision is scored by the nightly job and shows its components on /diario", async ({
  page,
  baseURL,
  request,
  browser,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const seeded = await page.request.post("/api/e2e/seed-decision", {
    headers: { "x-e2e-secret": e2eSecret ?? "" },
  });
  expect(seeded.ok()).toBe(true);

  await triggerIngestionAsOwner(browser, baseURL, e2eSecret ?? "", SESSION);

  await page.goto("/diario");
  await expect(page.getByText("Não entrar", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Tese confirmada", { exact: true })).toBeVisible();
  await expect(page.getByText(/Escore de Brier/)).toBeVisible();
  await expect(page.getByText("sem pontuação ainda")).not.toBeVisible();
});
