import Link from "next/link";
import { Check } from "lucide-react";
import type { Lesson } from "@fetha/contracts";

import { cn } from "@/lib/utils";

import type { LessonProgressStatus } from "../grouping";
import { t } from "../strings";

export function LessonRow({
  lesson,
  status,
  active = false,
}: {
  lesson: Lesson;
  status: LessonProgressStatus;
  active?: boolean;
}) {
  return (
    <Link
      href={`/aprender/${lesson.id}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "border-border flex min-h-11 items-center justify-between gap-3 border-b px-1 py-2 text-[13px] last:border-b-0",
        active ? "text-primary" : "hover:bg-secondary",
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium">{lesson.title.pt}</span>
        <span className="text-muted-foreground truncate">{lesson.summary.pt}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
          {t.lessonMinutes(lesson.minutes)}
        </span>
        {status.done ? (
          <span className="text-up inline-flex items-center gap-1" title={t.lessonDone}>
            <Check className="size-4" aria-hidden />
            <span className="sr-only">{t.lessonDone}</span>
          </span>
        ) : null}
      </div>
    </Link>
  );
}
