import type { Metadata } from "next";

import { AuthShell, MagicLinkForm, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.magicLink.title}` };

export default function MagicLinkPage() {
  return (
    <AuthShell title={t.magicLink.title} subtitle={t.magicLink.subtitle}>
      <MagicLinkForm />
    </AuthShell>
  );
}
