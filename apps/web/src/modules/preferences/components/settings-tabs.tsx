"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { settingsTabFromPathname, settingsTabHref, settingsTabs } from "../settings-tabs";
import { t } from "../strings";

export function SettingsTabs({ showAdministration }: { showAdministration: boolean }) {
  const current = settingsTabFromPathname(usePathname());
  const visibleTabs = settingsTabs.filter((tab) => tab !== "administracao" || showAdministration);

  return (
    <Tabs value={current}>
      <div className="border-border overflow-x-auto border-b">
        <TabsList variant="line" aria-label={t.settings.tabsLabel}>
          {visibleTabs.map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              nativeButton={false}
              render={<Link href={settingsTabHref(tab)} />}
            >
              {t.settings.tabs[tab]}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </Tabs>
  );
}
