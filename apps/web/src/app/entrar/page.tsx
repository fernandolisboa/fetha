import type { Metadata } from "next";

import { AuthShell, SignInForm, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.signIn.title}` };

export default function SignInPage() {
  return (
    <AuthShell title={t.signIn.title} subtitle={t.signIn.subtitle}>
      <SignInForm />
    </AuthShell>
  );
}
