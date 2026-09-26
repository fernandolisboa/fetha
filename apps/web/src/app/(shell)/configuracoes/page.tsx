import type { Metadata } from "next";

import { AccessLogPanel, getMyAccessLog, t as auditStrings } from "@/modules/audit";
import { requireUser, SignOutButton } from "@/modules/auth";
import { getPreferences, ThemePicker, t as preferencesStrings } from "@/modules/preferences";
import { getCurrentRiskProfile, t as portfolioStrings } from "@/modules/portfolio";
import { RiskProfileForm } from "@/modules/portfolio/client";
import { PageHeader, t } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.destinations.settings}` };

export default async function SettingsPage() {
  await requireUser();
  const preferences = await getPreferences();
  const riskProfile = await getCurrentRiskProfile();
  const accessLog = await getMyAccessLog();

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
          <h2 className="text-sm font-medium">{auditStrings.accessLog.title}</h2>
          <p className="text-muted-foreground text-xs">{auditStrings.accessLog.subtitle}</p>
        </div>
        <AccessLogPanel entries={accessLog} />
      </section>

      <section>
        <SignOutButton />
      </section>
    </div>
  );
}
