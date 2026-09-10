import type { ReactNode } from "react";

import type { CurrentUser } from "@/modules/auth";
import type { Preferences } from "@/modules/preferences";

import { Header } from "./header";
import { MarketBarProvider } from "./market-bar-context";
import { Rail } from "./rail";

export function AppShell({
  user,
  preferences,
  unreadSignalCount,
  children,
}: {
  user: CurrentUser;
  preferences: Preferences;
  unreadSignalCount: number;
  children: ReactNode;
}) {
  return (
    <MarketBarProvider>
      <div className="grid min-h-full grid-rows-[48px_1fr]">
        <Header email={user.email} />
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
