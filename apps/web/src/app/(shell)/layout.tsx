import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getSession } from "@/modules/auth";
import { getPreferences } from "@/modules/preferences";
import { AppShell } from "@/modules/shell";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await getSession();
  if (!user) {
    redirect("/entrar");
  }

  const preferences = await getPreferences();

  return (
    <AppShell user={user} preferences={preferences}>
      {children}
    </AppShell>
  );
}
