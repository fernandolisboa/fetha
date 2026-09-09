import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getDb } from "@/db/client";
import { getSession } from "@/modules/auth";
import { PreferencesRepository } from "@/modules/preferences";
import { AppShell } from "@/modules/shell";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await getSession();
  if (!user) {
    redirect("/entrar");
  }

  const preferences = await new PreferencesRepository(getDb(), user).find();

  return (
    <AppShell user={user} preferences={preferences}>
      {children}
    </AppShell>
  );
}
