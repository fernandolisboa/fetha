import type { ReactNode } from "react";
import type { Centavos } from "@fetha/contracts";

import type { CurrentUser } from "@/modules/auth";
import type { Preferences } from "@/modules/preferences";
import { cn } from "@/lib/utils";

import { Dock } from "./dock";
import { Header } from "./header";
import type { IbovMarketBarQuote, UsdBrlMarketBarQuote } from "./market-bar";
import { MarketBarProvider } from "./market-bar-context";
import { Rail } from "./rail";
import { StatusBar } from "./status-bar";
import { TabBar } from "./tab-bar";
import { TopNav } from "./top-nav";
import type { SearchSources } from "../search";

// Three layouts place the same parts (ADR-0069, ADR-0071): Workspace keeps
// the left rail and the header's market bar; Studio puts the destinations in
// the header as tabs and the market bar in a status bar at the bottom; Dock
// floats the destinations in a panel over the page's left edge. Under 768px
// all three are the phone shell with the bottom tab bar, which floats in Dock.
export function AppShell({
  user,
  preferences,
  unreadSignalCount,
  declaredCapital,
  search,
  usdBrl,
  ibov,
  children,
}: {
  user: CurrentUser;
  preferences: Preferences;
  unreadSignalCount: number;
  declaredCapital: Centavos | null;
  search: SearchSources;
  usdBrl: UsdBrlMarketBarQuote | null;
  ibov: IbovMarketBarQuote | null;
  children: ReactNode;
}) {
  const studio = preferences.layout === "studio";
  const dock = preferences.layout === "dock";

  return (
    <MarketBarProvider>
      <div
        className={cn(
          "grid min-h-full grid-cols-1 grid-rows-[var(--shell-header-height)_1fr]",
          dock ? "max-md:pb-[calc(3.5rem+2*var(--shell-float-inset))]" : "max-md:pb-14",
          studio && "md:pb-[var(--shell-status-height)]",
        )}
      >
        <Header
          email={user.email}
          search={search}
          usdBrl={usdBrl}
          ibov={ibov}
          navigation={studio ? <TopNav unreadSignalCount={unreadSignalCount} /> : undefined}
        />
        <div className="flex min-h-0 flex-1">
          {studio || dock ? null : (
            <Rail
              initialCollapsed={preferences.railCollapsed}
              unreadSignalCount={unreadSignalCount}
              declaredCapital={declaredCapital}
            />
          )}
          {dock ? (
            <Dock unreadSignalCount={unreadSignalCount} declaredCapital={declaredCapital} />
          ) : null}
          <main
            className={cn(
              "min-w-0 flex-1 overflow-y-auto",
              dock &&
                "md:pl-[calc(var(--shell-dock-width)+var(--shell-float-inset)+env(safe-area-inset-left))]",
            )}
          >
            {children}
          </main>
        </div>
        {studio ? (
          <StatusBar
            unreadSignalCount={unreadSignalCount}
            declaredCapital={declaredCapital}
            usdBrl={usdBrl}
            ibov={ibov}
          />
        ) : null}
        <TabBar unreadSignalCount={unreadSignalCount} floating={dock} />
      </div>
    </MarketBarProvider>
  );
}
