import { redirect } from "next/navigation";

import { settingsTabHref } from "@/modules/preferences";

export default function SettingsPage() {
  redirect(settingsTabHref("aparencia"));
}
