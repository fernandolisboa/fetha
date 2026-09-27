import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { AuthShell, getSession, hasPassword, SetPasswordForm, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.setPassword.title}` };

export default async function SetPasswordPage() {
  const currentUser = await getSession();
  if (!currentUser) {
    redirect("/entrar");
  }
  if (await hasPassword(getDb(), currentUser)) {
    redirect("/");
  }

  return (
    <AuthShell title={t.setPassword.title} subtitle={t.setPassword.subtitle}>
      <SetPasswordForm />
    </AuthShell>
  );
}
