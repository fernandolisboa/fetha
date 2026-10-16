import { requireUser } from "@/modules/auth";
import {
  getPreferences,
  LayoutPicker,
  ThemePicker,
  t as preferencesStrings,
} from "@/modules/preferences";

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
    </div>
  );
}
