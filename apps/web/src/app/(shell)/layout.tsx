import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getDb } from "@/db/client";
import { getSession, hasPassword, readTermsGate } from "@/modules/auth";
import { getPreferences } from "@/modules/preferences";
import { AppShell } from "@/modules/shell";
import { getMyUnreadSignalCount } from "@/modules/strategies";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await getSession();
  if (!user) {
    redirect("/entrar");
  }
  // Account deletion takes the password (docs/adr/0027), so no signed-in
  // screen is reachable before one is set (docs/adr/0028).
  if (!(await hasPassword(getDb(), user))) {
    redirect("/definir-senha");
  }
  // A stale or unconfirmed terms acceptance (docs/adr/0036) blocks the shell
  // the same way a missing password does: read from the database, never
  // from the session cookie, since the cookie predates any later terms
  // change. This runs on document loads only, like the `hasPassword` check
  // above: an already-open tab or a Server Action already in flight is not
  // interrupted mid-session.
  const termsGate = await readTermsGate(getDb(), user);
  if (termsGate.state !== "current") {
    redirect("/aceitar-termos");
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
