import { Panel } from "@/modules/shell/client";

import type { LevelGroup } from "../grouping";
import { levelProgress } from "../grouping";
import type { ProgressByLessonId } from "../grouping";
import { t } from "../strings";
import { LessonRow } from "./lesson-row";

export function LevelSection({
  group,
  progress,
  currentLessonId,
}: {
  group: LevelGroup;
  progress: ProgressByLessonId;
  currentLessonId?: string;
}) {
  const { done, total } = levelProgress(group.level, progress);

  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-medium">{group.title}</h2>
          <p className="text-muted-foreground text-xs">{group.description}</p>
        </div>
        {total > 0 ? (
          <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
            {t.levelProgress(done, total)}
          </span>
        ) : null}
      </div>
      {total === 0 ? (
        <p className="text-muted-foreground text-[13px]">{t.comingSoon}</p>
      ) : (
        <div className="flex flex-col">
          {group.lessons.map((row) => (
            <LessonRow
              key={row.lesson.id}
              lesson={row.lesson}
              status={row.status}
              active={row.lesson.id === currentLessonId}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}
