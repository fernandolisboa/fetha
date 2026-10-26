import { requireUser } from "@/modules/auth";
import {
  getPreferences,
  LayoutPicker,
  SuggestionArchivePicker,
  ThemePicker,
  t as preferencesStrings,
} from "@/modules/preferences";

import { setSuggestionArchiveAction } from "@/modules/radar/client";

import { SettingsSection } from "../_components/settings-section";

export default async function AppearanceSettingsPage() {
  await requireUser();
  const preferences = await getPreferences();

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title={preferencesStrings.layoutPicker.title}
        subtitle={preferencesStrings.layoutPicker.subtitle}
        className="@container"
      >
        <LayoutPicker current={preferences.layout} />
      </SettingsSection>
      <SettingsSection
        title={preferencesStrings.themePicker.title}
        subtitle={preferencesStrings.themePicker.subtitle}
        className="@container"
      >
        <ThemePicker current={preferences.theme} />
      </SettingsSection>
      <SettingsSection
        id="sugestoes"
        title={preferencesStrings.suggestionArchive.title}
        subtitle={preferencesStrings.suggestionArchive.subtitle}
        className="@container scroll-mt-20"
      >
        <SuggestionArchivePicker
          current={preferences.suggestionArchive}
          setAction={setSuggestionArchiveAction}
        />
      </SettingsSection>
    </div>
  );
}
