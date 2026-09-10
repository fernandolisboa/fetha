import type { Metadata } from "next";

import { AuthShell, parseEmailQueryParam, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.magicLink.sentTitle}` };

export default async function MagicLinkSentPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email: rawEmail } = await searchParams;
  const email = parseEmailQueryParam(rawEmail);

  return (
    <AuthShell title={t.magicLink.sentTitle}>
      <p className="text-sm">
        {email ? t.magicLink.sentBody.replace("{email}", email) : t.magicLink.sentBodyGeneric}
      </p>
    </AuthShell>
  );
}
