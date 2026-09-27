import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { AuthShell, getSession, hasPassword, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.verificationResult.successTitle}` };

export default async function VerificationResultPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const copy = t.verificationResult;

  if (!error) {
    const currentUser = await getSession();
    if (currentUser && !(await hasPassword(getDb(), currentUser))) {
      redirect("/definir-senha");
    }
  }

  return (
    <AuthShell title={error ? copy.errorTitle : copy.successTitle}>
      <p className="text-sm">{error ? copy.errorBody : copy.successBody}</p>
      <Link
        href={error ? "/verificar-email" : "/entrar"}
        className="mt-4 inline-block text-sm underline underline-offset-4"
      >
        {error ? copy.resendLink : copy.signInLink}
      </Link>
    </AuthShell>
  );
}
