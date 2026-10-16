import { requireUser } from "@/modules/auth";
import { getCurrentRiskProfile, t as portfolioStrings } from "@/modules/portfolio";
import { RiskProfileForm } from "@/modules/portfolio/client";

import { SettingsSection } from "../_components/settings-section";

export default async function RiskSettingsPage() {
  await requireUser();
  const riskProfile = await getCurrentRiskProfile();

  return (
    <SettingsSection
      title={portfolioStrings.riskProfileForm.title}
      subtitle={portfolioStrings.riskProfileForm.subtitle}
      className="max-w-2xl"
    >
      <RiskProfileForm current={riskProfile} />
    </SettingsSection>
  );
}
