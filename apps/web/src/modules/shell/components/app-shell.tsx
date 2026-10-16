import type { ReactNode } from "react";
import type { Centavos } from "@fetha/contracts";

import type { CurrentUser } from "@/modules/auth";
import type { Preferences } from "@/modules/preferences";
import { cn } from "@/lib/utils";

import { Header } from "./header";
import type { IbovMarketBarQuote, UsdBrlMarketBarQuote } from "./market-bar";
import { MarketBarProvider } from "./market-bar-context";
import { Rail } from "./rail";
import { StatusBar } from "./status-bar";
import { TabBar } from "./tab-bar";
import { TopNav } from "./top-nav";
import type { SearchSources } from "../search";

// Two layouts place the same parts (ADR-0069): Workspace keeps the left rail
// and the header's market bar; Studio puts the destinations in the header as
// tabs and the market bar in a status bar at the bottom. Under 768px both are
// the same phone shell with the bottom tab bar.
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

  return (
    <MarketBarProvider>
      <div
        className={cn(
          "grid min-h-full grid-cols-1 grid-rows-[var(--shell-header-height)_1fr] max-md:pb-14",
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
          {studio ? null : (
            <Rail
              initialCollapsed={preferences.railCollapsed}
              unreadSignalCount={unreadSignalCount}
              declaredCapital={declaredCapital}
            />
          )}
          <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        </div>
        {studio ? (
          <StatusBar
            unreadSignalCount={unreadSignalCount}
            declaredCapital={declaredCapital}
            usdBrl={usdBrl}
            ibov={ibov}
          />
        ) : null}
        <TabBar unreadSignalCount={unreadSignalCount} />
      </div>
    </MarketBarProvider>
  );
}
