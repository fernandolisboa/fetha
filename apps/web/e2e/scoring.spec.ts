import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
// Seeds a thesis-only decision through the E2E-only `/api/e2e/seed-decision`
// route (backdated `decided_at` to the already-ingested session
// `2026-09-08`, horizon the *next* ingested session `2026-09-09` — no
// look-ahead, #29 fix-web item 3), then triggers the nightly cron's manual
// POST trigger — same one `signals.spec.ts` and `decisions.spec.ts` use —
// and confirms `/diario` shows the decision already scored, with its
// components (#29 acceptance criterion b), not "pendente".
const e2eSecret = process.env.E2E_SECRET;
const cronSecret = process.env.CRON_SECRET;
const SESSION = "2026-09-09";

test.skip(
  !e2eSecret || !cronSecret,
  "E2E_SECRET or CRON_SECRET is not set; skipping the decision scoring flow.",
);

test("a seeded decision is scored by the nightly job and shows its components on /diario", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const seeded = await page.request.post("/api/e2e/seed-decision", {
    headers: { "x-e2e-secret": e2eSecret ?? "" },
  });
  expect(seeded.ok()).toBe(true);

  const triggered = await request.post(`${baseURL ?? ""}/api/cron/ingest`, {
    headers: { authorization: `Bearer ${cronSecret ?? ""}` },
    data: { session: SESSION },
  });
  expect(triggered.ok()).toBe(true);
  const outcome = (await triggered.json()) as { scoring: { decisionsScored: number } | null };
  expect(outcome.scoring?.decisionsScored).toBeGreaterThan(0);

  await page.goto("/diario");
  await expect(page.getByText("Não entrar", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Tese confirmada", { exact: true })).toBeVisible();
  await expect(page.getByText(/Escore de Brier/)).toBeVisible();
  await expect(page.getByText("sem pontuação ainda")).not.toBeVisible();
});
