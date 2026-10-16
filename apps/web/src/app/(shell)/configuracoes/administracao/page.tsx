import { notFound } from "next/navigation";

import { isOwner } from "@/modules/auth";
import {
  CorporateActionPanel,
  recentCorporateActionFactorsList,
  t as marketDataStrings,
} from "@/modules/market-data";
import { NightlyTriggerPanel, t as nightlyStrings } from "@/modules/nightly";

import { SettingsSection } from "../_components/settings-section";

// The owner's manual ingestion trigger below runs the same nightly job the
// cron route runs (#51), so it needs the same execution budget.
export const maxDuration = 300;

export default async function AdministrationSettingsPage() {
  if (!(await isOwner())) {
    notFound();
  }
  const corporateActionFactors = await recentCorporateActionFactorsList();

  return (
    <div className="@container">
      <div className="grid items-start gap-[14px] @min-[50rem]:grid-cols-2">
        <SettingsSection
          title={nightlyStrings.panel.title}
          subtitle={nightlyStrings.panel.subtitle}
        >
          <NightlyTriggerPanel />
        </SettingsSection>

        <SettingsSection
          title={marketDataStrings.corporateActionPanel.title}
          subtitle={marketDataStrings.corporateActionPanel.subtitle}
        >
          <CorporateActionPanel factors={corporateActionFactors} />
        </SettingsSection>
      </div>
    </div>
  );
}
