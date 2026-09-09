import type { Metadata } from "next";

import { AuthShell, parseEmailQueryParam, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.passwordReset.sentTitle}` };

export default async function PasswordResetSentPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email: rawEmail } = await searchParams;
  const email = parseEmailQueryParam(rawEmail);

  return (
    <AuthShell title={t.passwordReset.sentTitle}>
      <p className="text-sm">
        {email
          ? t.passwordReset.sentBody.replace("{email}", email)
          : t.passwordReset.sentBodyGeneric}
      </p>
    </AuthShell>
  );
}
