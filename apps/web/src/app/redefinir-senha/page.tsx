import type { Metadata } from "next";

import { AuthShell, RequestPasswordResetForm, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.passwordReset.requestTitle}` };

export default function RequestPasswordResetPage() {
  return (
    <AuthShell title={t.passwordReset.requestTitle} subtitle={t.passwordReset.requestSubtitle}>
      <RequestPasswordResetForm />
    </AuthShell>
  );
}
