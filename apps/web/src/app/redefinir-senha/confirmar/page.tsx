import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell, ResetPasswordForm, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.passwordReset.confirmTitle}` };

export default async function ConfirmPasswordResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  if (error || !token) {
    return (
      <AuthShell title={t.passwordReset.invalidLinkTitle}>
        <p className="text-sm">{t.passwordReset.invalidLinkBody}</p>
        <Link
          href="/redefinir-senha"
          className="mt-4 inline-block text-sm underline underline-offset-4"
        >
          {t.passwordReset.requestAgainLink}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t.passwordReset.confirmTitle}>
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
