import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
// PETR4 is one of B3's most liquid tickers and is expected to be present in
// every ingested session, so it stands in for "any instrument the nightly
// job (#12) has already loaded" without this spec seeding its own candles.
const e2eSecret = process.env.E2E_SECRET;
const TICKER = "PETR4";

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the watchlist and chart flow.");

test("add an instrument to the watchlist and open its chart", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.getByRole("button", { name: "Adicionar ativo" }).click();
  const searchInput = page.getByPlaceholder("Buscar pelo código");
  const status = page.getByRole("dialog").getByRole("status");

  await searchInput.fill("ZZZZ9");
  await expect(status).toHaveText("Nenhum ativo encontrado.");

  // Server Actions post to the current URL with a `next-action` header
  // rather than a distinguishing path, so this only delays a POST whose
  // body is the search's own `{"query": ...}` argument (not
  // addToWatchlistAction's `{"ticker": ...}`), and stays registered until
  // the option is actually visible so the request it delayed cannot race
  // past the "Buscando…" assertion below.
  await page.route("**/*", async (route) => {
    const routeRequest = route.request();
    if (
      routeRequest.method() === "POST" &&
      routeRequest.headers()["next-action"] &&
      routeRequest.postData()?.includes('"query"')
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    await route.continue();
  });

  await searchInput.fill(TICKER);
  await expect(status).toHaveText("Buscando…");
  const tickerOption = page.getByRole("option", { name: TICKER, exact: true });
  await expect(tickerOption).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });

  await tickerOption.click();

  // The instrument is already added; reopen the search purely to exercise
  // the failed and rate-limited announcements, in that order, with the
  // rate limit last because tripping it poisons every search for the rest
  // of its window and nothing after this needs a working search.
  await page.getByRole("button", { name: "Adicionar ativo" }).click();

  await page.route("**/*", async (route) => {
    const routeRequest = route.request();
    if (
      routeRequest.method() === "POST" &&
      routeRequest.headers()["next-action"] &&
      routeRequest.postData()?.includes('"query"')
    ) {
      await route.fulfill({ status: 500, body: "" });
      return;
    }
    await route.continue();
  });
  await searchInput.fill("VALE3");
  await expect(status).toHaveText("Não foi possível buscar ativos. Tente novamente.");
  await page.unrouteAll({ behavior: "wait" });

  // SEARCH_RATE_LIMIT in watchlist/actions.ts allows 30 requests per 10s
  // per account and only resets after a gap that long since the last one,
  // so firing enough distinct queries in a row trips it deterministically
  // regardless of how long the loop itself takes. Two requests already
  // landed above (the no-results and the delayed search); the aborted one
  // never reached the server, so it doesn't count.
  const RATE_LIMIT_ATTEMPTS = 40;
  for (let i = 0; i < RATE_LIMIT_ATTEMPTS; i += 1) {
    await searchInput.fill(`RL${String(i)}Q`);
    await page.waitForTimeout(300);
  }
  await expect(status).toHaveText(
    "Muitas buscas seguidas. Espere alguns segundos e tente de novo.",
    { timeout: 10_000 },
  );

  await page.keyboard.press("Escape");

  const row = page.getByRole("row", { name: new RegExp(TICKER) });
  await expect(row).toBeVisible();

  await row.getByRole("link", { name: TICKER }).click();

  await expect(page).toHaveURL(new RegExp(`/ativos/${TICKER}`));
  await expect(page.getByRole("heading", { name: TICKER })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Ajustada" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Nominal" })).toBeVisible();

  await page.getByRole("tab", { name: "Nominal" }).click();
  await expect(page).toHaveURL(/form=nominal/);
});
