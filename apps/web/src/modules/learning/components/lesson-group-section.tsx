import { Panel } from "@/modules/shell/client";

import type { LessonRow } from "../grouping";
import { LessonRow as LessonRowComponent } from "./lesson-row";

// Temas and Estruturas both regroup the same lessons under a plain title with no "Em breve"
// case (unlike Jornada's levels, every group here either has lessons or is left out, ADR-0081 /
// its PR 2 addendum): one component for both, taking just the title and lessons a `TopicGroup` or
// a `MarketViewGroup` already share.
export function LessonGroupSection({ group }: { group: { title: string; lessons: LessonRow[] } }) {
  if (group.lessons.length === 0) return null;

  return (
    <Panel title={group.title}>
      <div className="flex flex-col">
        {group.lessons.map((row) => (
          <LessonRowComponent key={row.lesson.id} lesson={row.lesson} status={row.status} />
        ))}
      </div>
    </Panel>
  );
}
