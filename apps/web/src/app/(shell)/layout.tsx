import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getDb } from "@/db/client";
import { getSession, hasPassword, readTermsGate } from "@/modules/auth";
import {
  ibovespa,
  latestCandle,
  latestExchangeRate,
  searchOptionSeriesAction,
  type ExchangeRateRow,
  type CandleRow,
} from "@/modules/market-data";
import { TourProvider } from "@/modules/help";
import { getMyDeclaredCapital } from "@/modules/portfolio";
import { getPreferences } from "@/modules/preferences";
import { AppShell } from "@/modules/shell";
import { getMyUnreadSignalCount, searchMyStrategiesAction } from "@/modules/strategies";
import { searchInstrumentsAction } from "@/modules/watchlist";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await getSession();
  if (!user) {
    redirect("/entrar");
  }
  // Account deletion takes the password (docs/adr/0027), so no signed-in
  // screen is reachable before one is set (docs/adr/0028).
  if (!(await hasPassword(getDb(), user))) {
    redirect("/definir-senha");
  }
  // A stale or unconfirmed terms acceptance (docs/adr/0036) blocks the shell
  // the same way a missing password does: read from the database, never
  // from the session cookie, since the cookie predates any later terms
  // change. This runs on document loads only, like the `hasPassword` check
  // above: an already-open tab or a Server Action already in flight is not
  // interrupted mid-session.
  const termsGate = await readTermsGate(getDb(), user);
  if (termsGate.state !== "current") {
    redirect("/aceitar-termos");
  }

  const [preferences, unreadSignalCount, declaredCapital, usdBrl, ibov] = await Promise.all([
    getPreferences(),
    getMyUnreadSignalCount(),
    getMyDeclaredCapital(),
    readLatestUsdBrl(),
    readLatestIbov(),
  ]);

  return (
    <TourProvider autoStart={!preferences.tourDismissed}>
      <AppShell
        user={user}
        preferences={preferences}
        unreadSignalCount={unreadSignalCount}
        declaredCapital={declaredCapital}
        search={{
          instruments: searchInstrumentsAction,
          optionSeries: searchOptionSeriesAction,
          strategies: searchMyStrategiesAction,
        }}
        usdBrl={usdBrl}
        ibov={ibov}
      >
        {children}
      </AppShell>
    </TourProvider>
  );
}

// A cosmetic shell fixture (the market bar chip, docs/adr/0061), not a
// dependency every signed-in page should 500 on: a migration not yet
// applied to this environment or a transient read failure just hides the
// chip instead of taking down the whole workstation shell.
async function readLatestUsdBrl(): Promise<ExchangeRateRow | null> {
  try {
    return (await latestExchangeRate(getDb(), "USDBRL")) ?? null;
  } catch {
    // A fixed marker, never the driver's message: it would carry database
    // text into the logs (docs/adr/0061).
    console.error("shell: latest USD/BRL PTAX read failed; market bar chip hidden");
    return null;
  }
}

// Same fail-soft shape as readLatestUsdBrl above (ADR-0062): a migration not yet applied or a
// transient read failure just hides the IBOV chip instead of taking down the shell.
async function readLatestIbov(): Promise<CandleRow | null> {
  try {
    return await latestCandle(getDb(), ibovespa.ticker);
  } catch {
    console.error("shell: latest IBOV11 read failed; market bar chip hidden");
    return null;
  }
}
