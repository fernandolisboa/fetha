import type { Metadata } from "next";

import { AuthShell, SignUpForm, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.signUp.title}` };

export default function SignUpPage() {
  return (
    <AuthShell title={t.signUp.title} subtitle={t.signUp.subtitle}>
      <SignUpForm />
    </AuthShell>
  );
}
