import { expect, test } from "./tour";

import { registerAndSignIn, TEST_TIMEOUT_MS } from "./helpers";

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
  test.setTimeout(TEST_TIMEOUT_MS);
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const runId = `${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
  const strategyName = `SMA cruza o fechamento ${runId}`;
  const revisedName = `SMA cruza o fechamento ${runId} (revisado)`;

  await page.goto("/estrategias");
  await page.getByRole("link", { name: "Nova estratégia" }).click();

  // On a wide monitor the editor's panels sit in two columns instead of one long narrow stack.
  await page.setViewportSize({ width: 1920, height: 1080 });
  const entryHeading = page.getByRole("heading", { level: 2, name: "Condições de entrada" });
  const sizingHeading = page.getByRole("heading", { level: 2, name: "Dimensionamento" });
  await expect
    .poll(async () => {
      const entryBox = await entryHeading.boundingBox();
      const sizingBox = await sizingHeading.boundingBox();
      return (sizingBox?.x ?? 0) > (entryBox?.x ?? 0) && sizingBox?.y === entryBox?.y;
    })
    .toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByLabel("Nome").fill(strategyName);

  // The editor defaults "Estrutura" to the catalog's first structure by
  // name, which is not necessarily this one and can carry strike legs that
  // block submission with an empty strike list; picking it explicitly keeps
  // this spec correct regardless of catalog contents or ordering.
  await page.getByRole("combobox", { name: "Estrutura" }).click();
  await page.getByRole("option", { name: "Compra de ação", exact: true }).click();

  await page.getByRole("button", { name: "Criar estratégia" }).click();

  // The regex must not also match /estrategias/nova: "nova" satisfies
  // [^/]+ just as well as a real strategy id would.
  await expect(page).toHaveURL(/\/estrategias\/(?!nova$)[^/]+$/);
  await expect(page.getByText("v1", { exact: false })).toBeVisible();

  // The strategy page puts its versions and backtests beside the editor on a wide monitor, and
  // below it on a phone.
  const versionsHeading = page.getByRole("heading", { level: 2, name: "Versões" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect
    .poll(async () => {
      const entryBox = await entryHeading.boundingBox();
      const versionsBox = await versionsHeading.boundingBox();
      return (versionsBox?.x ?? 0) > (entryBox?.x ?? 0) + 1000;
    })
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const entryBox = await entryHeading.boundingBox();
      const versionsBox = await versionsHeading.boundingBox();
      return (versionsBox?.y ?? 0) > (entryBox?.y ?? 0);
    })
    .toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });

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

  // The list's Visibility cell must follow the row's share toggle, not keep
  // the value the page was rendered with.
  await page.goto("/estrategias");
  const ownRow = page.getByRole("row", { name: revisedName });
  await expect(ownRow.getByRole("cell", { name: "Compartilhada", exact: true })).toBeVisible();
  await ownRow.getByRole("button", { name: `Parar de compartilhar ${revisedName}` }).click();
  await expect(
    ownRow.getByRole("button", { name: `Compartilhar ${revisedName}`, exact: true }),
  ).toBeVisible();
  await expect(ownRow.getByRole("cell", { name: "Privada", exact: true })).toBeVisible();

  // Archiving takes it out of "Minhas estratégias" and into "Arquivadas";
  // unarchiving reverses that, with no confirmation dialog either way
  // (docs/adr/0043: archiving is reversible).
  await ownRow.getByRole("button", { name: `Arquivar ${revisedName}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Desarquivar ${revisedName}` })).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Arquivar ${revisedName}`, exact: true }),
  ).not.toBeVisible();

  await page.getByRole("button", { name: `Desarquivar ${revisedName}` }).click();
  await expect(
    page.getByRole("button", { name: `Arquivar ${revisedName}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: `Desarquivar ${revisedName}` })).not.toBeVisible();
});
