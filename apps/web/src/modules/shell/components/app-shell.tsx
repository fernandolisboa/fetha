import type { ReactNode } from "react";

import type { CurrentUser } from "@/modules/auth";
import type { Preferences } from "@/modules/preferences";

import { Header } from "./header";
import { MarketBarProvider } from "./market-bar-context";
import { Rail } from "./rail";
import type { InstrumentSearchFn, StrategySearchFn } from "../search";

export function AppShell({
  user,
  preferences,
  unreadSignalCount,
  searchInstruments,
  searchStrategies,
  children,
}: {
  user: CurrentUser;
  preferences: Preferences;
  unreadSignalCount: number;
  searchInstruments: InstrumentSearchFn;
  searchStrategies: StrategySearchFn;
  children: ReactNode;
}) {
  return (
    <MarketBarProvider>
      <div className="grid min-h-full grid-rows-[48px_1fr]">
        <Header
          email={user.email}
          searchInstruments={searchInstruments}
          searchStrategies={searchStrategies}
        />
        <div className="flex min-h-0 flex-1">
          <Rail
            initialCollapsed={preferences.railCollapsed}
            unreadSignalCount={unreadSignalCount}
          />
          <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </MarketBarProvider>
  );
}
