import { expect, test } from "./tour";

import { registerAndSignIn } from "./helpers";

// Runs by hand against a Vercel preview deployment; see apps/web/e2e/README.md.
// Covers #382's critical path: open an option operation, roll it leg by leg to the next
// monthly expiry's nearest traded strike, and confirm the roll chain history (and its CSV
// export) is reachable from both ends of the roll.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the roll flow.");

interface RollPair {
  underlying: string;
  right: "call" | "put";
  session: string;
  ticker: string;
  strike: string;
  close: string;
  expiry: string;
  nextExpiry: string;
  nextTicker: string;
}

function toDisplayDate(iso: string): string {
  const parts = iso.split("-");
  const year = parts[0] ?? "";
  const month = parts[1] ?? "";
  const day = parts[2] ?? "";
  return `${day}/${month}/${year}`;
}

test("roll an open option operation to the next monthly series", async ({
  page,
  baseURL,
  request,
}) => {
  test.setTimeout(120_000);

  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  const lookup = await page.request.get("/api/e2e/roll-pair", {
    headers: { "x-e2e-secret": e2eSecret ?? "" },
  });
  expect(lookup.ok(), "the preview should have two monthly PETR4 expiries ingested").toBe(true);
  const pair = (await lookup.json()) as RollPair;

  await page.goto("/carteira");

  await page.getByRole("button", { name: "Registrar execução" }).click();
  const recordDialog = page.getByRole("dialog");
  await recordDialog.getByLabel("Ativo").fill(pair.ticker);
  await recordDialog.getByLabel("Quantidade").fill("1");
  await recordDialog.getByLabel("Preço").fill(pair.close.replace(".", ","));
  await recordDialog.getByLabel("Data").fill(pair.session);
  await recordDialog.getByRole("button", { name: "Registrar execução" }).click();
  await expect(recordDialog).not.toBeVisible();

  const fillDate = toDisplayDate(pair.session);
  await page
    .getByRole("checkbox", { name: `Selecionar execução ${pair.ticker} ${fillDate}` })
    .check();
  await page.getByRole("button", { name: "Agrupar em nova operação" }).click();

  // The roll agenda panel's own subtitle also contains the substring "Operações", so a plain
  // `hasText` filter picks that section instead of the operations table below it; this scopes
  // to the section whose own heading is exactly "Operações".
  const operations = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Operações", exact: true }) });
  const openRow = operations.getByRole("row", { name: new RegExp(pair.ticker) });
  // Grouping re-renders the whole page server-side, including the payoff diagram the engine
  // prices for the new operation: slower than the default 5s under a cold dev-style run.
  await expect(openRow).toBeVisible({ timeout: 30_000 });

  await openRow.getByRole("button", { name: "Rolar" }).click();
  const rollDialog = page.getByRole("dialog");

  await expect(rollDialog.getByText("Ordens de encerramento")).toBeVisible();
  await expect(
    rollDialog.locator("span.font-mono.uppercase", { hasText: pair.ticker }),
  ).toBeVisible();

  await expect(rollDialog.getByText("Ordens de abertura")).toBeVisible();
  await expect(
    rollDialog.locator("span.font-mono.uppercase", { hasText: pair.nextTicker }),
  ).toBeVisible();

  await rollDialog.getByRole("button", { name: "Registrar rolagem" }).click();
  await expect(rollDialog).not.toBeVisible();

  // The closed leg leaves "Pernas abertas" empty once rolled away, so the closed row is found by
  // its status instead (a fresh test account never holds another operation to confuse it with).
  const closedRow = operations.getByRole("row", { name: /encerrada/ });
  const openedRow = operations.getByRole("row", { name: new RegExp(pair.nextTicker) });
  await expect(closedRow).toBeVisible({ timeout: 30_000 });
  await expect(openedRow).toBeVisible({ timeout: 30_000 });

  const closedChainLink = closedRow.getByRole("link", { name: "Histórico de rolagens" });
  const openedChainLink = openedRow.getByRole("link", { name: "Histórico de rolagens" });
  await expect(closedChainLink).toBeVisible();
  await expect(openedChainLink).toBeVisible();

  await openedChainLink.click();
  await expect(page).toHaveURL(/\/carteira\/operacoes\/[^/]+$/);

  await expect(page.getByRole("heading", { name: "Histórico de rolagens" })).toBeVisible();
  await expect(page.getByRole("row", { name: /\d{4}-\d{2}/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Baixar CSV" })).toBeVisible();
});
