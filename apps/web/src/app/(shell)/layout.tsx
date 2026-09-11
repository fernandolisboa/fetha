import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getSession } from "@/modules/auth";
import { getPreferences } from "@/modules/preferences";
import { AppShell } from "@/modules/shell";
import { getMyUnreadSignalCount } from "@/modules/strategies";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await getSession();
  if (!user) {
    redirect("/entrar");
  }

  const [preferences, unreadSignalCount] = await Promise.all([
    getPreferences(),
    getMyUnreadSignalCount(),
  ]);

  return (
    <AppShell user={user} preferences={preferences} unreadSignalCount={unreadSignalCount}>
      {children}
    </AppShell>
  );
}
