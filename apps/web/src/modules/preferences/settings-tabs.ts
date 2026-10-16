export const settingsTabs = ["aparencia", "risco", "ia", "conta", "administracao"] as const;

export type SettingsTab = (typeof settingsTabs)[number];

const SETTINGS_PATH = "/configuracoes";

export function settingsTabHref(tab: SettingsTab): string {
  return `${SETTINGS_PATH}/${tab}`;
}

export function settingsTabFromPathname(pathname: string): SettingsTab | null {
  if (!pathname.startsWith(`${SETTINGS_PATH}/`)) return null;
  const [segment] = pathname.slice(`${SETTINGS_PATH}/`.length).split("/");
  return settingsTabs.find((tab) => tab === segment) ?? null;
}
