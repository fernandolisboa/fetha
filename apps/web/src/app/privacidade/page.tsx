import type { Metadata } from "next";

import { LegalDocumentView, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.privacy.title}` };

export default function PrivacyPage() {
  return <LegalDocumentView document={t.privacy} />;
}
