import type { Metadata } from "next";

import { AuthShell, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.passwordReset.sentTitle}` };

export default async function PasswordResetSentPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <AuthShell title={t.passwordReset.sentTitle}>
      {email ? (
        <p className="text-sm">{t.passwordReset.sentBody.replace("{email}", email)}</p>
      ) : null}
    </AuthShell>
  );
}
