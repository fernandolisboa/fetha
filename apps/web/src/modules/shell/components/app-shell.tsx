import type { ReactNode } from "react";

import type { CurrentUser } from "@/modules/auth";
import type { Preferences } from "@/modules/preferences";

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
      <Header email={user.email} />
      <div className="flex min-h-0 flex-1">
        <Rail initialCollapsed={preferences.railCollapsed} />
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
