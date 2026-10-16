import type { Metadata } from "next";
import type { ReactNode } from "react";

import { isOwner, requireUser } from "@/modules/auth";
import { SettingsTabs, t as preferencesStrings } from "@/modules/preferences";
import { PageHeader, t } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.destinations.settings}` };

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  await requireUser();
  const ownerSession = await isOwner();

  return (
    <div className="flex flex-col gap-6 px-5 py-8">
      <PageHeader
        overline={preferencesStrings.settings.overline}
        headline={t.destinations.settings}
      />
      <SettingsTabs showAdministration={ownerSession} />
      {children}
    </div>
  );
}
