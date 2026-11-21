import Link from "next/link";
import type { Lesson } from "@fetha/contracts";

import { buttonVariants } from "@/components/ui/button";
import { Panel } from "@/modules/shell/client";

import { t } from "../strings";

export function ContinueCard({ lesson }: { lesson: Lesson | null }) {
  if (!lesson) {
    return (
      <Panel title={t.continueCard.title}>
        <p className="text-muted-foreground text-[13px]">{t.continueCard.allDone}</p>
      </Panel>
    );
  }

  return (
    <Panel title={t.continueCard.title}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold">{lesson.title.pt}</span>
          <span className="text-muted-foreground text-[13px]">{lesson.summary.pt}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
            {t.continueCard.minutes(lesson.minutes)}
          </span>
          <Link href={`/aprender/${lesson.id}`} className={buttonVariants({ size: "sm" })}>
            {t.continueCard.cta}
          </Link>
        </div>
      </div>
    </Panel>
  );
}
