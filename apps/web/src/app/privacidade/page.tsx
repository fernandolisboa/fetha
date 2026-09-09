import type { Metadata } from "next";

import { t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.privacy.title}` };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-xl font-semibold tracking-tight">{t.privacy.title}</h1>
      <p className="text-muted-foreground mt-4 text-sm">{t.privacy.body}</p>
    </main>
  );
}
