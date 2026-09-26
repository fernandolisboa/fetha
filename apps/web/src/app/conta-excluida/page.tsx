import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { AuthShell, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.accountDeleted.title}` };

export default function AccountDeletedPage() {
  return (
    <AuthShell title={t.accountDeleted.title}>
      <p className="text-sm">{t.accountDeleted.body}</p>
      <div className="mt-4">
        <Link href="/entrar" className={buttonVariants({ variant: "outline" })}>
          {t.accountDeleted.home}
        </Link>
      </div>
    </AuthShell>
  );
}
