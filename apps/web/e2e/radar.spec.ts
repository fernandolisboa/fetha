import { expect, test } from "./tour";

import { registerAndSignIn } from "./helpers";

// The preview holds a handful of sessions, far short of the history a recipe's entry reads, so
// the nightly radar finds nothing there; `/api/e2e/seed-radar` files one PETR4 row at its newest
// ingested close (owner.setup.ts ingests it) under the bull call spread recipe.
const e2eSecret = process.env.E2E_SECRET;
const TICKER = "PETR4";

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the radar flow.");

test("open the radar tab, see a recipe's entry and add the asset to the watchlist", async ({
  page,
  baseURL,
  request,
}) => {
  test.setTimeout(90_000);

  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const seeded = await page.request.post("/api/e2e/seed-radar", {
    headers: { "x-e2e-secret": e2eSecret ?? "" },
  });
  expect(seeded.status()).toBe(201);

  await page.getByRole("tab", { name: "Radar" }).click();
  await expect(page).toHaveURL(/\?aba=radar$/);
  await expect(page.getByTestId("radar-session")).toBeVisible();

  const row = page.getByRole("row", { name: new RegExp(TICKER) });
  await expect(row.getByText("A receita Trava de alta com calls encontrou entrada")).toBeVisible();
  await expect(row.getByRole("list", { name: "Como fica uma unidade" })).toContainText(
    "Compra call",
  );

  await row.getByRole("button", { name: "Adicionar à watchlist" }).click();
  await expect(row.getByText("Na sua watchlist")).toBeVisible();

  await page.getByRole("tab", { name: "Watchlist" }).click();
  await expect(page).toHaveURL(new RegExp(`${baseURL ?? ""}/?$`));
  await expect(page.getByRole("link", { name: TICKER, exact: true })).toBeVisible();
});
