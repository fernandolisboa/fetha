import type { Metadata } from "next";

import { AuthShell, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.magicLink.sentTitle}` };

export default async function MagicLinkSentPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <AuthShell title={t.magicLink.sentTitle}>
      {email ? <p className="text-sm">{t.magicLink.sentBody.replace("{email}", email)}</p> : null}
    </AuthShell>
  );
}
