import { expect, test } from "@playwright/test";

// Runs by hand against a Vercel preview deployment (see apps/web/e2e/README.md):
//   CRON_SECRET=... PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app pnpm --filter @fetha/web test:e2e
const cronSecret = process.env.CRON_SECRET;

test.skip(!cronSecret, "CRON_SECRET is not set; skipping the manual ingestion trigger.");

test("the owner's manual ingestion trigger accepts a bearer and an optional session date", async ({
  baseURL,
  request,
}) => {
  const secret: string = cronSecret ?? "";

  const unauthorized = await request.post(`${baseURL ?? ""}/api/cron/ingest`);
  expect(unauthorized.status()).toBe(401);

  const triggered = await request.post(`${baseURL ?? ""}/api/cron/ingest`, {
    headers: { authorization: `Bearer ${secret}` },
    data: { session: "2026-09-08" },
  });
  expect(triggered.ok()).toBe(true);
  const body = (await triggered.json()) as { ok: boolean; session: string | null };
  expect(body.ok).toBe(true);
  expect(body.session).toBe("2026-09-08");
});
