import type { Metadata } from "next";

import { requireUser } from "@/modules/auth";
import { HowToUseGuide, t } from "@/modules/onboarding";
import { PageHeader } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.guide.title}` };

export default async function HowToUsePage() {
  await requireUser();

  return (
    <div className="flex flex-col gap-8 px-5 py-8">
      <div className="flex max-w-2xl flex-col gap-2">
        <PageHeader overline={t.guide.overline} headline={t.guide.title} />
        <p className="text-muted-foreground text-[13px]">{t.guide.intro}</p>
      </div>
      <HowToUseGuide />
    </div>
  );
}
