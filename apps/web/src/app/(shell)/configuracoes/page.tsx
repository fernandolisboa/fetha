import type { Metadata } from "next";
import Link from "next/link";

import { ExportDataLink, t as accountStrings } from "@/modules/account";
import { AccessLogPanel, getMyAccessLog, t as auditStrings } from "@/modules/audit";
import {
  DeleteAccountDialog,
  isOwner,
  requireUser,
  SignOutButton,
  t as authStrings,
} from "@/modules/auth";
import { NightlyTriggerPanel, t as nightlyStrings } from "@/modules/nightly";
import { getPreferences, ThemePicker, t as preferencesStrings } from "@/modules/preferences";
import { getCurrentRiskProfile, t as portfolioStrings } from "@/modules/portfolio";
import { RiskProfileForm } from "@/modules/portfolio/client";
import { PageHeader, t } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.destinations.settings}` };

// The owner's manual ingestion trigger below runs the same nightly job the
// cron route runs (#51), so it needs the same execution budget.
export const maxDuration = 300;

export default async function SettingsPage() {
  await requireUser();
  const preferences = await getPreferences();
  const riskProfile = await getCurrentRiskProfile();
  const accessLog = await getMyAccessLog();
  const ownerSession = await isOwner();

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 px-5 py-8">
      <PageHeader
        overline={preferencesStrings.settings.overline}
        headline={t.destinations.settings}
      />

      <section className="border-border bg-card flex flex-col gap-3 rounded-[var(--radius)] border p-4">
        <div>
          <h2 className="text-sm font-medium">{preferencesStrings.themePicker.title}</h2>
          <p className="text-muted-foreground text-xs">{preferencesStrings.themePicker.subtitle}</p>
        </div>
        <ThemePicker current={preferences.theme} />
      </section>

      <section className="border-border bg-card flex flex-col gap-3 rounded-[var(--radius)] border p-4">
        <div>
          <h2 className="text-sm font-medium">{portfolioStrings.riskProfileForm.title}</h2>
          <p className="text-muted-foreground text-xs">
            {portfolioStrings.riskProfileForm.subtitle}
          </p>
        </div>
        <RiskProfileForm current={riskProfile} />
      </section>

      <section className="border-border bg-card flex flex-col gap-3 rounded-[var(--radius)] border p-4">
        <div>
          <h2 className="text-sm font-medium">{accountStrings.dataExport.title}</h2>
          <p className="text-muted-foreground text-xs">{accountStrings.dataExport.subtitle}</p>
        </div>
        <div>
          <ExportDataLink />
        </div>
        <p className="text-muted-foreground text-xs">
          <Link href="/termos" className="underline underline-offset-4">
            {authStrings.terms.title}
          </Link>
          {" · "}
          <Link href="/privacidade" className="underline underline-offset-4">
            {authStrings.privacy.title}
          </Link>
        </p>
      </section>

      <section className="border-border bg-card flex flex-col gap-3 rounded-[var(--radius)] border p-4">
        <div>
          <h2 className="text-sm font-medium">{auditStrings.accessLog.title}</h2>
          <p className="text-muted-foreground text-xs">{auditStrings.accessLog.subtitle}</p>
        </div>
        <AccessLogPanel entries={accessLog} />
      </section>

      <section className="border-border bg-card flex flex-col gap-3 rounded-[var(--radius)] border p-4">
        <div>
          <h2 className="text-sm font-medium">{authStrings.deleteAccount.title}</h2>
          <p className="text-muted-foreground text-xs">{authStrings.deleteAccount.subtitle}</p>
        </div>
        <div>
          <DeleteAccountDialog />
        </div>
      </section>

      {ownerSession ? (
        <section className="border-border bg-card flex flex-col gap-3 rounded-[var(--radius)] border p-4">
          <div>
            <h2 className="text-sm font-medium">{nightlyStrings.panel.title}</h2>
            <p className="text-muted-foreground text-xs">{nightlyStrings.panel.subtitle}</p>
          </div>
          <NightlyTriggerPanel />
        </section>
      ) : null}

      <section>
        <SignOutButton />
      </section>
    </div>
  );
}
