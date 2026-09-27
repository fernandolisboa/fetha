import type { Metadata } from "next";

import { LegalDocumentView, t } from "@/modules/auth";

export const metadata: Metadata = { title: `Fetha · ${t.terms.title}` };

export default function TermsPage() {
  return <LegalDocumentView document={t.terms} />;
}
