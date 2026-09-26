import type { Metadata } from "next";

import { AuthShell, parseEmailQueryParam, ResendVerificationForm, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.verifyEmail.title}` };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email: rawEmail } = await searchParams;
  const email = parseEmailQueryParam(rawEmail);

  return (
    <AuthShell title={t.verifyEmail.title}>
      {email ? <p className="text-sm">{t.verifyEmail.body.replace("{email}", email)}</p> : null}
      <div className="mt-4">
        <ResendVerificationForm email={email} />
      </div>
    </AuthShell>
  );
}
