import { expect, test } from "@playwright/test";

import { readLatestLink, signUp } from "./support";

// Runs by hand against a Vercel preview deployment (see apps/web/e2e/README.md):
//   E2E_SECRET=... PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app pnpm --filter @fetha/web test:e2e
// Requires REGISTRATION_MODE=open on that deployment (or a matching invite),
// since the flow registers a brand-new account end to end before signing in
// with a magic link.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the magic link flow against a preview.");

test("magic link sign-in for a verified account", async ({ page, baseURL, request }) => {
  const email = `fetha-e2e-magic-link-${String(Date.now())}@example.com`;
  const secret: string = e2eSecret ?? "";

  await signUp(page, {
    name: "Magic Link User",
    email,
    password: "correct-horse-battery-staple",
  });

  const verificationLink = await readLatestLink(request, baseURL, email, secret);
  await page.goto(verificationLink);
  await expect(page.getByText("E-mail confirmado")).toBeVisible();

  await page.goto("/link-magico");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link mágico" }).click();
  await expect(page).toHaveURL(/\/link-magico\/verifique\?email=/);

  const magicLink = await readLatestLink(request, baseURL, email, secret);
  await page.goto(magicLink);

  await expect(page).toHaveURL(baseURL ?? "/");
  await expect(page.getByText(email)).toBeVisible();
});

test("an expired or reused magic link shows the error screen", async ({
  page,
  baseURL,
  request,
}) => {
  const email = `fetha-e2e-magic-link-invalid-${String(Date.now())}@example.com`;
  const secret: string = e2eSecret ?? "";

  await signUp(page, {
    name: "Magic Link Invalid",
    email,
    password: "correct-horse-battery-staple",
  });

  const verificationLink = await readLatestLink(request, baseURL, email, secret);
  await page.goto(verificationLink);

  await page.goto("/link-magico");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link mágico" }).click();
  await expect(page).toHaveURL(/\/link-magico\/verifique/);

  const magicLink = await readLatestLink(request, baseURL, email, secret);
  await page.goto(magicLink);
  await expect(page).toHaveURL(baseURL ?? "/");

  await page.goto(magicLink);
  await expect(page).toHaveURL(/\/link-magico\/erro/);
  await expect(
    page.getByRole("heading", { name: /link mágico é inválido ou expirou/ }),
  ).toBeVisible();
});
