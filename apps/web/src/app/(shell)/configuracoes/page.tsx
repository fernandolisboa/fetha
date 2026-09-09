import type { Metadata } from "next";

import { getDb } from "@/db/client";
import { requireUser, SignOutButton } from "@/modules/auth";
import { PreferencesRepository, ThemePicker, t as preferencesStrings } from "@/modules/preferences";
import { t } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.destinations.settings}` };

export default async function SettingsPage() {
  const user = await requireUser();
  const preferences = await new PreferencesRepository(getDb(), user).find();

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 px-5 py-8">
      <div>
        <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
          {preferencesStrings.settings.overline}
        </p>
        <h1 className="text-[22px] font-semibold tracking-tight">{t.destinations.settings}</h1>
      </div>

      <section className="border-border bg-card flex flex-col gap-3 rounded-[var(--radius)] border p-4">
        <div>
          <h2 className="text-sm font-medium">{preferencesStrings.themePicker.title}</h2>
          <p className="text-muted-foreground text-xs">{preferencesStrings.themePicker.subtitle}</p>
        </div>
        <ThemePicker current={preferences.theme} />
      </section>

      <section>
        <SignOutButton />
      </section>
    </div>
  );
}
