import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ExportDataLink, t as accountStrings } from "@/modules/account";
import { AiModelSettingsPanel, getMyAiSettings, t as aiModelsStrings } from "@/modules/ai-models";
import { AccessLogPanel, getMyAccessLog, groupAccessLog, t as auditStrings } from "@/modules/audit";
import {
  DeleteAccountDialog,
  isOwner,
  requireUser,
  SignOutButton,
  t as authStrings,
} from "@/modules/auth";
import {
  CorporateActionPanel,
  recentCorporateActionFactorsList,
  t as marketDataStrings,
} from "@/modules/market-data";
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
  const aiSettings = await getMyAiSettings();
  const accessLogGroups = groupAccessLog(await getMyAccessLog());
  const ownerSession = await isOwner();
  const corporateActionFactors = ownerSession ? await recentCorporateActionFactorsList() : [];

  return (
    <div className="flex flex-col gap-8 px-5 py-8">
      <PageHeader
        overline={preferencesStrings.settings.overline}
        headline={t.destinations.settings}
      />

      <div className="columns-[24rem] gap-[14px]">
        <SettingsSection
          title={preferencesStrings.themePicker.title}
          subtitle={preferencesStrings.themePicker.subtitle}
        >
          <ThemePicker current={preferences.theme} />
        </SettingsSection>

        <SettingsSection
          title={portfolioStrings.riskProfileForm.title}
          subtitle={portfolioStrings.riskProfileForm.subtitle}
        >
          <RiskProfileForm current={riskProfile} />
        </SettingsSection>

        <SettingsSection
          title={aiModelsStrings.panel.title}
          subtitle={aiModelsStrings.panel.subtitle}
        >
          <AiModelSettingsPanel
            modelFamilies={aiSettings.modelFamilies}
            apiKey={aiSettings.apiKey}
            serverKeyConfigured={aiSettings.serverKeyConfigured}
            resolvedModels={aiSettings.resolvedModels}
          />
        </SettingsSection>

        <SettingsSection
          title={accountStrings.dataExport.title}
          subtitle={accountStrings.dataExport.subtitle}
        >
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
        </SettingsSection>

        <SettingsSection
          title={auditStrings.accessLog.title}
          subtitle={auditStrings.accessLog.subtitle}
        >
          <AccessLogPanel groups={accessLogGroups} />
        </SettingsSection>

        {ownerSession ? (
          <SettingsSection
            title={nightlyStrings.panel.title}
            subtitle={nightlyStrings.panel.subtitle}
          >
            <NightlyTriggerPanel />
          </SettingsSection>
        ) : null}

        {ownerSession ? (
          <SettingsSection
            title={marketDataStrings.corporateActionPanel.title}
            subtitle={marketDataStrings.corporateActionPanel.subtitle}
          >
            <CorporateActionPanel factors={corporateActionFactors} />
          </SettingsSection>
        ) : null}

        <SettingsSection
          title={authStrings.deleteAccount.title}
          subtitle={authStrings.deleteAccount.subtitle}
        >
          <div>
            <DeleteAccountDialog />
          </div>
        </SettingsSection>
      </div>

      <section>
        <SignOutButton />
      </section>
    </div>
  );
}

function SettingsSection({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-border bg-card mb-[14px] flex break-inside-avoid flex-col gap-3 rounded-[var(--radius)] border p-4">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-muted-foreground text-xs">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}
