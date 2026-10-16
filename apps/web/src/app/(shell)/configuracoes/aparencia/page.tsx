import { requireUser } from "@/modules/auth";
import { getPreferences, ThemePicker, t as preferencesStrings } from "@/modules/preferences";

import { SettingsSection } from "../_components/settings-section";

export default async function AppearanceSettingsPage() {
  await requireUser();
  const preferences = await getPreferences();

  return (
    <SettingsSection
      title={preferencesStrings.themePicker.title}
      subtitle={preferencesStrings.themePicker.subtitle}
      className="@container"
    >
      <ThemePicker current={preferences.theme} />
    </SettingsSection>
  );
}
