import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.magicLink.errorTitle}` };

export default function MagicLinkErrorPage() {
  return (
    <AuthShell title={t.magicLink.errorTitle}>
      <p className="text-sm">{t.magicLink.errorBody}</p>
      <Link href="/link-magico" className="mt-4 inline-block text-sm underline underline-offset-4">
        {t.magicLink.requestAgainLink}
      </Link>
    </AuthShell>
  );
}
