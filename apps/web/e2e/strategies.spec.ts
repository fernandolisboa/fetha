import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
const e2eSecret = process.env.E2E_SECRET;
const protectionBypass = process.env.VERCEL_PROTECTION_BYPASS;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the strategy editor flow.");

test("create a strategy, edit it into a new version, share it, and copy it as another user", async ({
  page,
  browser,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const runId = `${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
  const strategyName = `SMA cruza o fechamento ${runId}`;
  const revisedName = `SMA cruza o fechamento ${runId} (revisado)`;

  await page.goto("/estrategias");
  await page.getByRole("link", { name: "Nova estratégia" }).click();

  await page.getByLabel("Nome").fill(strategyName);
  await page.getByRole("button", { name: "Criar estratégia" }).click();

  // The regex must not also match /estrategias/nova: "nova" satisfies
  // [^/]+ just as well as a real strategy id would.
  await expect(page).toHaveURL(/\/estrategias\/(?!nova$)[^/]+$/);
  await expect(page.getByText("v1", { exact: false })).toBeVisible();

  await page.getByLabel("Nome").fill(revisedName);
  await page.getByRole("button", { name: "Salvar nova versão" }).click();

  await expect(page.getByText("v2", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Compartilhar" }).click();
  await expect(page.getByRole("button", { name: "Parar de compartilhar" })).toBeVisible();

  // `browser.newContext()` does not inherit the project's `use` options
  // (baseURL, the Vercel deployment-protection bypass headers): a second,
  // independently authenticated user needs them passed explicitly or every
  // request hits the SSO challenge page instead of the app.
  const otherContext = await browser.newContext({
    baseURL,
    ...(protectionBypass
      ? {
          extraHTTPHeaders: {
            "x-vercel-protection-bypass": protectionBypass,
            "x-vercel-set-bypass-cookie": "true",
          },
        }
      : {}),
  });
  const otherPage = await otherContext.newPage();
  await registerAndSignIn(otherPage, otherContext.request, baseURL, e2eSecret ?? "");

  await otherPage.goto("/estrategias");
  const sharedRow = otherPage.getByRole("row", { name: revisedName });
  await expect(sharedRow).toBeVisible();
  await sharedRow.getByRole("button", { name: "Copiar" }).click();

  await expect(otherPage).toHaveURL(/\/estrategias\/(?!nova$)[^/]+$/);
  await expect(otherPage.getByText("v1", { exact: false })).toBeVisible();

  await otherContext.close();
});
