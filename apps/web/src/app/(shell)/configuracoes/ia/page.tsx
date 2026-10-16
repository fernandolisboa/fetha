import { requireUser } from "@/modules/auth";
import { AiModelSettingsPanel, getMyAiSettings, t as aiModelsStrings } from "@/modules/ai-models";

import { SettingsSection } from "../_components/settings-section";

export default async function AiSettingsPage() {
  await requireUser();
  const aiSettings = await getMyAiSettings();

  return (
    <SettingsSection
      title={aiModelsStrings.panel.title}
      subtitle={aiModelsStrings.panel.subtitle}
      className="max-w-3xl"
    >
      <AiModelSettingsPanel
        modelFamilies={aiSettings.modelFamilies}
        apiKey={aiSettings.apiKey}
        resolvedModels={aiSettings.resolvedModels}
      />
    </SettingsSection>
  );
}
