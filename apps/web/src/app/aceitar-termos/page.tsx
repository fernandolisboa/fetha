import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ExportDataLink } from "@/modules/account";
import {
  AcceptTermsForm,
  AuthShell,
  DeleteAccountDialog,
  getSession,
  hasPassword,
  readTermsGate,
  SignOutButton,
  t,
} from "@/modules/auth";
import { getDb } from "@/db/client";

// State-neutral: this title must read the same whether the gate is asking
// for a first acceptance or a re-acceptance (docs/adr/0036).
export const metadata: Metadata = { title: `Fetha · ${t.terms.title}` };

export default async function AcceptTermsPage() {
  const currentUser = await getSession();
  if (!currentUser) {
    redirect("/entrar");
  }
  if (!(await hasPassword(getDb(), currentUser))) {
    redirect("/definir-senha");
  }
  const gate = await readTermsGate(getDb(), currentUser);
  if (gate.state === "current") {
    redirect("/");
  }

  const isFirstAcceptance = gate.state === "unconfirmed";
  const labels = t.acceptTerms;

  return (
    <AuthShell
      title={isFirstAcceptance ? labels.confirmDetailsTitle : labels.changedTitle}
      subtitle={isFirstAcceptance ? labels.confirmDetailsSubtitle : labels.changedSubtitle}
    >
      <div className="flex flex-col gap-6">
        {!isFirstAcceptance ? (
          <div className="flex flex-col gap-1.5">
            <h2 className="text-sm font-medium">{labels.whatChanged}</h2>
            <p className="text-muted-foreground text-sm">{t.termsChangeSummary}</p>
          </div>
        ) : null}

        <AcceptTermsForm showNameField={isFirstAcceptance} />

        <div className="border-border flex flex-col gap-3 border-t pt-4">
          <div>
            <h2 className="text-sm font-medium">{labels.secondaryActionsTitle}</h2>
            <p className="text-muted-foreground text-xs">{labels.secondaryActionsBody}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExportDataLink />
            <DeleteAccountDialog />
            <SignOutButton />
          </div>
          <p className="text-muted-foreground text-xs">
            <Link href="/termos" className="underline underline-offset-4">
              {t.terms.title}
            </Link>
            {" · "}
            <Link href="/privacidade" className="underline underline-offset-4">
              {t.privacy.title}
            </Link>
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
