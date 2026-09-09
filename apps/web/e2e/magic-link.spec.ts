import { expect, test } from "@playwright/test";

// Runs by hand against a Vercel preview deployment (see apps/web/e2e/README.md):
//   E2E_SECRET=... PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app pnpm --filter @fetha/web test:e2e
// Requires REGISTRATION_MODE=open on that deployment (or a matching invite),
// since the flow registers a brand-new account end to end before signing in
// with a magic link.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the magic link flow against a preview.");

async function readLatestLink(
  request: import("@playwright/test").APIRequestContext,
  baseURL: string | undefined,
  email: string,
  secret: string,
): Promise<string> {
  const linkResponse = await request.get(
    `${baseURL ?? ""}/api/e2e/verification-link?email=${encodeURIComponent(email)}`,
    { headers: { "x-e2e-secret": secret } },
  );
  expect(linkResponse.ok()).toBe(true);
  const { link } = (await linkResponse.json()) as { link: string };
  return link;
}

test("magic link sign-in for a verified account", async ({ page, baseURL, request }) => {
  const email = `fetha-e2e-magic-link-${String(Date.now())}@example.com`;
  const secret: string = e2eSecret ?? "";

  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill("Magic Link User");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("correct-horse-battery-staple");
  await page.getByRole("checkbox", { name: /Aceito os termos de uso/ }).check();
  await page.getByRole("checkbox", { name: /Aceito a política de privacidade/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/verificar-email\?email=/);

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

  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill("Magic Link Invalid");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("correct-horse-battery-staple");
  await page.getByRole("checkbox", { name: /Aceito os termos de uso/ }).check();
  await page.getByRole("checkbox", { name: /Aceito a política de privacidade/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/verificar-email\?email=/);

  const verificationLink = await readLatestLink(request, baseURL, email, secret);
  await page.goto(verificationLink);

  await page.goto("/link-magico");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link mágico" }).click();

  const magicLink = await readLatestLink(request, baseURL, email, secret);
  await page.goto(magicLink);
  await expect(page).toHaveURL(baseURL ?? "/");

  await page.goto(magicLink);
  await expect(page).toHaveURL(/\/link-magico\/erro/);
  await expect(page.getByText("Esse link é inválido ou expirou")).toBeVisible();
});
