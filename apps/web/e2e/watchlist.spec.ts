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
  // registerAndSignIn's sign-up throttle can itself sleep up to
  // SIGN_UP_WINDOW_MS (e2e/support.ts), and the rate-limit loop below adds
  // several more seconds of its own; both together can exceed Playwright's
  // default 30s test budget.
  test.setTimeout(90_000);

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
  // of its window and nothing after this needs a working search. Waiting
  // for the added row first gives the popover's close animation time to
  // finish, so the reopen click below can't race a still-closing instance.
  const row = page.getByRole("row", { name: new RegExp(TICKER) });
  await expect(row).toBeVisible();

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
  // per account and only resets after a 10s gap since the *last* request
  // that actually reached the server (a rejected one leaves lastRequest
  // untouched, account-rate-limit.ts's guarded UPDATE). So this can't rely
  // on tripping "no matter how long the loop takes": if each iteration is
  // slow enough, the window can expire mid-loop and the next query is
  // accepted instead of throttled. Each wait is only just past the 200ms
  // search debounce, and the loop stops as soon as the rate-limited text
  // shows up, both to keep the whole run inside SEARCH_RATE_LIMIT's own
  // window and to avoid 40 unconditional waits when it trips much earlier.
  const rateLimitedText = "Muitas buscas seguidas. Espere alguns segundos e tente de novo.";
  const RATE_LIMIT_MAX_ATTEMPTS = 40;
  let rateLimited = false;
  for (let i = 0; i < RATE_LIMIT_MAX_ATTEMPTS && !rateLimited; i += 1) {
    await searchInput.fill(`RL${String(i)}Q`);
    await page.waitForTimeout(220);
    rateLimited = (await status.textContent()) === rateLimitedText;
  }
  expect(rateLimited).toBe(true);

  await page.keyboard.press("Escape");

  await row.getByRole("link", { name: TICKER }).click();

  await expect(page).toHaveURL(new RegExp(`/ativos/${TICKER}`));
  await expect(page.getByRole("heading", { name: TICKER })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Ajustada" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Nominal" })).toBeVisible();

  await page.getByRole("tab", { name: "Nominal" }).click();
  await expect(page).toHaveURL(/form=nominal/);
});
