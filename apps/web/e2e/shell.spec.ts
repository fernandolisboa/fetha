import { expect, skipTourWhenShown, test } from "./tour";

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
  await expect(page.getByTestId("market-bar")).toBeVisible();
});

test("under 768px the rail becomes a bottom tab bar with the six destinations", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");
  await page.setViewportSize({ width: 390, height: 844 });

  const navigation = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(navigation).toHaveCount(1);
  await expect(navigation).toHaveAttribute("data-tour", "tab-bar");
  const names = ["Watchlist", "Sinais", "Estratégias", "Carteira", "Diário", "Configurações"];
  for (const name of names) {
    const link = navigation.getByRole("link", { name });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const barBox = await navigation.boundingBox();
  expect((barBox?.y ?? 0) + (barBox?.height ?? 0)).toBeCloseTo(844, 0);
  await expect(navigation.getByRole("link", { name: "Watchlist" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await navigation.getByRole("link", { name: "Sinais" }).click();
  await expect(page).toHaveURL(/\/sinais$/);
  await expect(navigation.getByRole("link", { name: "Sinais" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.setViewportSize({ width: 1024, height: 844 });
  await expect(navigation).toHaveAttribute("data-tour", "rail");
});

// Chromium applies env(safe-area-inset-*) only through this DevTools
// override; a real notched phone also needs the viewport-fit=cover asserted
// below, or iOS letterboxes the page and reports 0 insets (#246).
test("an installed PWA on a notched phone keeps the shell clear of the notch and home indicator", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /viewport-fit=cover/,
  );

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 47, bottom: 34, left: 0, right: 0 },
  });
  await page.setViewportSize({ width: 390, height: 844 });

  const header = page.getByRole("banner");
  const headerBox = await header.boundingBox();
  expect(headerBox?.y).toBe(0);
  const wordmarkBox = await header.getByText("Fetha", { exact: true }).boundingBox();
  expect(wordmarkBox?.y ?? 0).toBeGreaterThanOrEqual(47);

  const navigation = page.getByRole("navigation", { name: "Navegação principal" });
  const barBox = await navigation.boundingBox();
  expect((barBox?.y ?? 0) + (barBox?.height ?? 0)).toBeCloseTo(844, 0);
  const watchlistBox = await navigation.getByRole("link", { name: "Watchlist" }).boundingBox();
  expect((watchlistBox?.y ?? 0) + (watchlistBox?.height ?? 0)).toBeLessThanOrEqual(844 - 34);
  expect(watchlistBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 0, bottom: 21, left: 47, right: 47 },
  });
  for (const width of [667, 844]) {
    await page.setViewportSize({ width, height: 375 });
    const landscapeHeaderBox = await header.boundingBox();
    expect(landscapeHeaderBox?.x).toBe(0);
    expect(landscapeHeaderBox?.width).toBe(width);
    const wordmark = await header.getByText("Fetha", { exact: true }).boundingBox();
    expect(wordmark?.x ?? 0).toBeGreaterThanOrEqual(47);
    const accountBox = await page.getByRole("button", { name: "Menu da conta" }).boundingBox();
    expect((accountBox?.x ?? 0) + (accountBox?.width ?? Infinity)).toBeLessThanOrEqual(width - 47);

    const links = navigation.getByRole("link");
    const firstBox = await links.first().boundingBox();
    const lastBox = await links.last().boundingBox();
    expect(firstBox?.x ?? 0).toBeGreaterThanOrEqual(47);
    expect((lastBox?.x ?? 0) + (lastBox?.width ?? Infinity)).toBeLessThanOrEqual(width - 47);
  }
});

test("header fits phone, tablet and desktop widths without overflowing", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");
  // The asset page's own tour (#304) starts 600ms after load; the width loop
  // below can outlast that, and its overlay would then take the search click.
  await skipTourWhenShown(page);
  await page.goto("/ativos/PETR4");
  await expect(page.getByRole("banner").getByText("PETR4")).toBeVisible();

  for (const width of [360, 390, 800, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    const budget = await page.evaluate(() => document.documentElement.clientWidth);

    const pageScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageScrollWidth).toBeLessThanOrEqual(budget);
    const headerScrollWidth = await page
      .getByRole("banner")
      .evaluate((element) => element.scrollWidth);
    expect(headerScrollWidth).toBeLessThanOrEqual(budget);

    const accountBox = await page.getByRole("button", { name: "Menu da conta" }).boundingBox();
    expect(accountBox).not.toBeNull();
    expect((accountBox?.x ?? 0) + (accountBox?.width ?? Infinity)).toBeLessThanOrEqual(budget);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Buscar ativo, série ou estratégia" }).click();
  await expect(
    page.getByRole("dialog", { name: "Buscar ativo, série ou estratégia" }),
  ).toBeVisible();
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
  await expect(dialog.getByText("Nenhum ativo, série ou estratégia encontrado.")).not.toBeVisible();

  await page.getByPlaceholder("Buscar ativo, série ou estratégia").fill("zzzzzzzzzz");
  await expect(status).toHaveText("Nenhum ativo, série ou estratégia encontrado.");
});

// PETR4 is one of B3's most liquid tickers and is expected to be present in
// every ingested session (see watchlist.spec.ts), so this navigates the
// palette to it without seeding a candle of its own.
test("Ctrl K palette navigates to an instrument result", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Buscar ativo, série ou estratégia").fill("PETR");

  const option = page.getByRole("option", { name: "PETR4", exact: true });
  await expect(option).toBeVisible();
  await option.click();

  await expect(page).toHaveURL(/\/ativos\/PETR4$/);
});

// Same reference-data assumption as operation-builder.spec.ts: nightly
// ingestion keeps at least one live PETR4 series in the registry.
test("the palette navigates to an option series page", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.getByRole("button", { name: "Buscar ativo, série ou estratégia" }).click();
  await page.getByPlaceholder("Buscar ativo, série ou estratégia").fill("PETR");

  const seriesGroup = page.getByRole("group", { name: "Séries de opção" });
  const firstSeries = seriesGroup.getByRole("option").first();
  await expect(firstSeries).toBeVisible();
  const seriesTicker = (await firstSeries.locator("span").first().textContent()) ?? "";
  expect(seriesTicker).toMatch(/^PETR[A-Z0-9]+$/);
  await firstSeries.click();

  await expect(page).toHaveURL(new RegExp(`/opcoes/${seriesTicker}$`));
  await expect(page.getByRole("heading", { level: 1, name: seriesTicker })).toBeVisible();
  await expect(page.getByText("Série de opção", { exact: true })).toBeVisible();
  await expect(page.getByText(/^(Call|Put)$/)).toBeVisible();
  await expect(page.getByText(/^(Americana|Europeia)$/)).toBeVisible();
  await expect(page.getByText(/^Strike \d[\d.]*,\d{2}$/)).toBeVisible();
  await expect(page.getByText(/^Vence em \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();

  // PETR3 and PETR4 options share the PETR root, so either can come first.
  const underlyingLink = page.getByRole("link", { name: /^Ver PETR[34]$/ });
  const underlying = ((await underlyingLink.textContent()) ?? "").replace("Ver ", "");
  await underlyingLink.click();
  await expect(page).toHaveURL(new RegExp(`/ativos/${underlying}$`));
});

test("the palette navigates to a strategy result", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const runId = `${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
  const strategyName = `Busca pelo Ctrl K ${runId}`;

  await page.goto("/estrategias");
  await page.getByRole("link", { name: "Nova estratégia" }).click();
  await page.getByLabel("Nome").fill(strategyName);
  await page.getByRole("combobox", { name: "Estrutura" }).click();
  await page.getByRole("option", { name: "Compra de ação", exact: true }).click();
  await page.getByRole("button", { name: "Criar estratégia" }).click();
  await expect(page).toHaveURL(/\/estrategias\/(?!nova$)[^/]+$/);
  const strategyUrl = page.url();

  // Ctrl K's listener is attached after hydration, so a key press right
  // after a navigation can be lost; a click on the trigger is replayed (#240).
  await page.goto("/");
  await page.getByRole("button", { name: "Buscar ativo, série ou estratégia" }).click();
  await page.getByPlaceholder("Buscar ativo, série ou estratégia").fill(`Ctrl K ${runId}`);

  const option = page.getByRole("option", { name: strategyName, exact: true });
  await expect(option).toBeVisible();
  await option.click();

  await expect(page).toHaveURL(strategyUrl);
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
  {
    theme: "ouro-negro",
    label: /Ouro Negro/,
    bodyFamily: "jetbrainsmono",
    monoFamily: "jetbrainsmono",
  },
  { theme: "fosforo", label: /Fósforo/, bodyFamily: "jetbrainsmono", monoFamily: "jetbrainsmono" },
] as const;

test("each theme resolves its own vendored font families", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const tabularNumberElement = page.getByTestId("market-bar");

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

// ADR-0069: the light theme tells the browser to draw native controls light.
test("Papel is a light theme down to the native controls", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");
  await page.goto("/configuracoes/aparencia");

  await page.getByRole("radio", { name: /Papel/ }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "papel");
  await expect
    .poll(() => page.locator("html").evaluate((el) => getComputedStyle(el).colorScheme))
    .toBe("light");
});

// ADR-0069: Studio puts the destinations in the header and the market bar in
// a status bar at the bottom; the rail is gone. The choice survives a reload.
test("layout switch to Studio moves the navigation and the market bar, and persists", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");
  await page.goto("/configuracoes/aparencia");
  const navigation = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(navigation).toHaveAttribute("data-tour", "rail");

  await page.getByRole("radio", { name: /Studio/ }).click();

  await expect(page.locator("html")).toHaveAttribute("data-layout", "studio");
  await expect(navigation).toHaveAttribute("data-tour", "top-nav");
  await expect(page.getByRole("button", { name: "Recolher a navegação" })).toHaveCount(0);
  const statusBar = page.getByRole("contentinfo", { name: "Barra de status" });
  await expect(statusBar.getByTestId("market-bar")).toBeVisible();
  await expect(statusBar).toContainText("Nenhum sinal não lido");
  await expect(statusBar.getByRole("link", { name: "não declarado" })).toHaveAttribute(
    "href",
    "/configuracoes/risco",
  );
  await expect(navigation.getByRole("link", { name: "Configurações" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-layout", "studio");
  await expect(navigation).toHaveAttribute("data-tour", "top-nav");

  await page.getByRole("radio", { name: /Workspace/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-layout", "workspace");
  await expect(navigation).toHaveAttribute("data-tour", "rail");
});

// ADR-0071: Dock floats the destinations over the page's left edge, icons at
// rest and labels while hovered; the page starts right of it, never under it.
// Under 768px the tab bar floats inset from the screen edges.
test("layout switch to Dock floats the navigation beside the page, and persists", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/configuracoes/aparencia");
  const navigation = page.getByRole("navigation", { name: "Navegação principal" });

  await page.getByRole("radio", { name: /Dock/ }).click();

  await expect(page.locator("html")).toHaveAttribute("data-layout", "dock");
  await expect(navigation).toHaveAttribute("data-tour", "dock");
  await expect(page.getByRole("button", { name: "Recolher a navegação" })).toHaveCount(0);
  await expect(page.getByRole("contentinfo", { name: "Barra de status" })).toHaveCount(0);
  await expect(page.locator("header").getByTestId("market-bar")).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Configurações" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const headline = page.getByRole("main").getByRole("heading", { level: 1 });
  const restingBox = await navigation.boundingBox();
  const headlineBox = await headline.boundingBox();
  expect(restingBox?.width ?? 0).toBeLessThanOrEqual(56);
  expect(restingBox?.x ?? 0).toBeGreaterThan(0);
  expect(restingBox?.y ?? 0).toBeGreaterThan(48);
  expect(headlineBox?.x ?? 0).toBeGreaterThan((restingBox?.x ?? 0) + (restingBox?.width ?? 0));
  await expect(navigation.getByText("Capital declarado")).toBeHidden();

  await navigation.hover();
  await expect.poll(async () => (await navigation.boundingBox())?.width ?? 0).toBe(200);
  await expect(navigation.getByText("Capital declarado")).toBeVisible();
  expect((await headline.boundingBox())?.x).toBe(headlineBox?.x);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-layout", "dock");
  await expect(navigation).toHaveAttribute("data-tour", "dock");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(navigation).toHaveAttribute("data-tour", "tab-bar");
  await expect(navigation).toHaveAttribute("data-floating", "true");
  const tabBarBox = await navigation.boundingBox();
  expect(tabBarBox?.x ?? 0).toBeGreaterThan(0);
  expect((tabBarBox?.y ?? 0) + (tabBarBox?.height ?? 0)).toBeLessThan(844);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("radio", { name: /Workspace/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-layout", "workspace");
  await expect(navigation).toHaveAttribute("data-tour", "rail");
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

test("rail and header stay put while a long page scrolls", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/como-usar");
  await expect(page.getByRole("heading", { level: 1, name: "Como usar a Fetha" })).toBeVisible();

  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  const header = page.locator("header");
  const rail = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(header).toBeInViewport({ ratio: 1 });
  await expect(rail).toBeInViewport({ ratio: 1 });
  await expect(rail.getByText("Capital declarado")).toBeInViewport();

  // Sub-pixel slack: at the very bottom the page's fractional height can
  // nudge the sticky rail by half a pixel.
  const headerBox = await header.boundingBox();
  const railBox = await rail.boundingBox();
  expect(headerBox?.y).toBe(0);
  expect(Math.abs((railBox?.y ?? 0) - 48)).toBeLessThanOrEqual(1);
  expect(Math.abs((railBox?.y ?? 0) + (railBox?.height ?? 0) - 600)).toBeLessThanOrEqual(1);

  const panelTitle = page.getByRole("main").getByRole("heading", { level: 2, name: "Sinais" });
  await panelTitle.evaluate((element) => {
    element.scrollIntoView({ block: "start" });
  });
  const titleBox = await panelTitle.boundingBox();
  expect(titleBox?.y ?? 0).toBeGreaterThanOrEqual(48);
});

test("collapsed rail keeps its foot inside its width", async ({ page, baseURL, request }) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const rail = page.getByRole("navigation", { name: "Navegação principal" });
  const capital = rail.getByText("Capital declarado");
  await expect(capital).toBeVisible();

  await Promise.all([
    page.waitForResponse((res) => res.request().method() === "POST"),
    rail.getByRole("button", { name: "Recolher a navegação" }).click(),
  ]);

  await expect(capital).toBeHidden();
  await expect(rail).toHaveAttribute("data-collapsed", "true");
  await expect
    .poll(() => rail.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBe(0);
});

test("rail foot shows the declared capital once it is declared", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const rail = page.getByRole("navigation", { name: "Navegação principal" });
  await rail.getByRole("link", { name: "não declarado" }).click();
  await expect(page).toHaveURL(/\/configuracoes\/risco$/);

  await page.getByLabel("Capital declarado").fill("10.000,00");
  await page.getByRole("button", { name: "Salvar perfil de risco" }).click();
  await expect(page.getByText("Perfil de risco salvo.")).toBeVisible();

  await expect(rail.getByText("R$ 10.000,00")).toBeVisible();
  await expect(rail.getByRole("link", { name: "não declarado" })).toHaveCount(0);
});

test("PWA manifest and service worker are served", async ({ request, baseURL }) => {
  const manifestResponse = await request.get(`${baseURL ?? ""}/manifest.webmanifest`);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as { name: string };
  expect(manifest.name).toBe("Fetha");

  const swResponse = await request.get(`${baseURL ?? ""}/sw.js`);
  expect(swResponse.ok()).toBe(true);
});

test("Como usar lays its sections in two columns on a wide monitor", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");
  await page.goto("/como-usar");
  const main = page.getByRole("main");
  const watchlist = main.getByRole("heading", { level: 2, name: "Watchlist" });
  const portfolio = main.getByRole("heading", { level: 2, name: "Carteira" });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect
    .poll(async () => {
      const watchlistBox = await watchlist.boundingBox();
      const portfolioBox = await portfolio.boundingBox();
      return (portfolioBox?.x ?? 0) > (watchlistBox?.x ?? 0) && portfolioBox?.y === watchlistBox?.y;
    })
    .toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const watchlistBox = await watchlist.boundingBox();
      const portfolioBox = await portfolio.boundingBox();
      return (portfolioBox?.y ?? 0) > (watchlistBox?.y ?? 0);
    })
    .toBe(true);
});
