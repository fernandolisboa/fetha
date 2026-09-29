import type { ReactNode } from "react";

import type { CurrentUser } from "@/modules/auth";
import type { Preferences } from "@/modules/preferences";

import { Header } from "./header";
import { MarketBarProvider } from "./market-bar-context";
import { Rail } from "./rail";
import { TabBar } from "./tab-bar";
import type { SearchSources } from "../search";

export function AppShell({
  user,
  preferences,
  unreadSignalCount,
  search,
  children,
}: {
  user: CurrentUser;
  preferences: Preferences;
  unreadSignalCount: number;
  search: SearchSources;
  children: ReactNode;
}) {
  return (
    <MarketBarProvider>
      <div className="grid min-h-full grid-cols-1 grid-rows-[48px_1fr] max-md:pb-14">
        <Header email={user.email} search={search} />
        <div className="flex min-h-0 flex-1">
          <Rail
            initialCollapsed={preferences.railCollapsed}
            unreadSignalCount={unreadSignalCount}
          />
          <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        </div>
        <TabBar unreadSignalCount={unreadSignalCount} />
      </div>
    </MarketBarProvider>
  );
}
