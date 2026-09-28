import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the workstation shell flow.");

test("shell renders after login with the six destinations", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const rail = page.getByRole("navigation", { name: "Navegação principal" });
  for (const name of [
    "Watchlist",
    "Sinais",
    "Estratégias",
    "Carteira",
    "Diário",
    "Configurações",
  ]) {
    await expect(rail.getByRole("link", { name })).toBeVisible();
  }
  await expect(page.getByText("sem dados")).toBeVisible();
});

test("Ctrl K palette opens and announces its empty state once typing starts", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Buscar ativo, série ou estratégia" });
  await expect(dialog).toBeVisible();

  const status = dialog.getByRole("status");
  await expect(status).toHaveText("");

  await page.getByPlaceholder("Buscar ativo, série ou estratégia").fill("xyz");
  await expect(status).toHaveText("Ainda não há nada para buscar.");
});

test("theme switch persists across reload", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "terminal");

  await page.getByRole("button", { name: "Menu da conta" }).click();
  // Scoped to the open menu: the rail's own "Configurações" destination
  // link shares the same accessible name and would otherwise match first.
  // Base UI's menu items keep role="menuitem" even when rendered as <a>
  // (the ARIA menu pattern), so this does not match role="link".
  await page.getByRole("menu").getByRole("menuitem", { name: "Configurações" }).click();
  await expect(page).toHaveURL(/\/configuracoes/);

  await page.getByRole("radio", { name: /Terminal/ }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "terminal");

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "terminal");
});

// #158: next/font/local replaced next/font/google; each theme's --font-body
// and --font-mono (globals.css) must still resolve to the vendored family
// next/font names after the export in src/app/fonts.ts, at the weight the
// page actually renders, not merely load without a network error.
const themeFontExpectations = [
  {
    theme: "instrumento",
    label: /Instrumento/,
    bodyFamily: "ibmplexsans",
    monoFamily: "ibmplexmono",
  },
  {
    theme: "terminal",
    label: /Terminal/,
    bodyFamily: "jetbrainsmono",
    monoFamily: "jetbrainsmono",
  },
  { theme: "amplo", label: /Amplo/, bodyFamily: "sourcesans3", monoFamily: "sourcecodepro" },
] as const;

test("each theme resolves its own vendored font families", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const tabularNumberElement = page.getByText("sem dados");

  for (const { theme, label, bodyFamily, monoFamily } of themeFontExpectations) {
    await page.getByRole("button", { name: "Menu da conta" }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Configurações" }).click();
    await expect(page).toHaveURL(/\/configuracoes/);
    await page.getByRole("radio", { name: label }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    await page.evaluate(() => document.fonts.ready);

    const computedBodyFamily = await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).fontFamily);
    const computedMonoFamily = await tabularNumberElement.evaluate(
      (el) => getComputedStyle(el).fontFamily,
    );
    const normalize = (value: string) => value.toLowerCase().replace(/[\s"']/g, "");

    expect(normalize(computedBodyFamily)).toContain(bodyFamily);
    expect(normalize(computedMonoFamily)).toContain(monoFamily);

    const [bodyFirstFamily] = computedBodyFamily.split(",");
    const [monoFirstFamily] = computedMonoFamily.split(",");
    const bodyLoaded = await page.evaluate(
      (family) => document.fonts.check(`400 13px ${family}`),
      bodyFirstFamily?.trim() ?? "",
    );
    const monoLoaded = await page.evaluate(
      (family) => document.fonts.check(`400 13px ${family}`),
      monoFirstFamily?.trim() ?? "",
    );

    expect(bodyLoaded, `${theme}: body font ${bodyFirstFamily ?? ""} did not load`).toBe(true);
    expect(monoLoaded, `${theme}: mono font ${monoFirstFamily ?? ""} did not load`).toBe(true);
  }
});

test("account menu opens the Como usar guide, one section per destination", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.getByRole("button", { name: "Menu da conta" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Como usar" }).click();
  await expect(page).toHaveURL(/\/como-usar$/);
  await expect(page.getByRole("heading", { level: 1, name: "Como usar a Fetha" })).toBeVisible();

  const main = page.getByRole("main");
  for (const name of [
    "Watchlist",
    "Sinais",
    "Estratégias",
    "Carteira",
    "Diário",
    "Configurações",
  ]) {
    await expect(main.getByRole("heading", { level: 2, name })).toBeVisible();
  }

  await main.getByRole("link", { name: "Abrir Sinais" }).click();
  await expect(page).toHaveURL(/\/sinais$/);
});

test("rail collapse persists across reload", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const rail = page.getByRole("navigation", { name: "Navegação principal" });
  // The link keeps its accessible name through its title when collapsed, so
  // the assertion targets the label text inside the rail's own link.
  const watchlistLink = rail.getByRole("link", { name: "Watchlist" });
  const watchlistLabel = watchlistLink.getByText("Watchlist", { exact: true });

  await expect(watchlistLabel).toBeVisible();

  await Promise.all([
    page.waitForResponse((res) => res.request().method() === "POST"),
    rail.getByRole("button", { name: "Recolher a navegação" }).click(),
  ]);
  await expect(watchlistLabel).toBeHidden();

  await page.reload();

  await expect(watchlistLabel).toBeHidden();
  await expect(watchlistLink).toBeVisible();
});

test("PWA manifest and service worker are served", async ({ request, baseURL }) => {
  const manifestResponse = await request.get(`${baseURL ?? ""}/manifest.webmanifest`);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as { name: string };
  expect(manifest.name).toBe("Fetha");

  const swResponse = await request.get(`${baseURL ?? ""}/sw.js`);
  expect(swResponse.ok()).toBe(true);
});
