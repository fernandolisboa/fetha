import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.verificationResult.successTitle}` };

export default async function VerificationResultPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const copy = t.verificationResult;

  return (
    <AuthShell title={error ? copy.errorTitle : copy.successTitle}>
      <p className="text-sm">{error ? copy.errorBody : copy.successBody}</p>
      <Link href="/entrar" className="mt-4 inline-block text-sm underline underline-offset-4">
        {copy.signInLink}
      </Link>
    </AuthShell>
  );
}
