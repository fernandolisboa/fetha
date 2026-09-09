import type { ReactNode } from "react";

import type { CurrentUser } from "@/modules/auth";
import type { Preferences } from "@/modules/preferences";

import { BottomTabBar } from "./bottom-tab-bar";
import { Header } from "./header";
import { Rail } from "./rail";

export function AppShell({
  user,
  preferences,
  children,
}: {
  user: CurrentUser;
  preferences: Preferences;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-full grid-rows-[48px_1fr]">
      <Header email={user.email} theme={preferences.theme} />
      <div className="flex min-h-0 flex-1">
        <Rail initialCollapsed={preferences.railCollapsed} />
        <main className="min-w-0 flex-1 overflow-y-auto pb-14 md:pb-0">{children}</main>
      </div>
      <BottomTabBar />
    </div>
  );
}
