import { Panel } from "@/modules/shell/client";

import type { MarketViewGroup } from "../grouping";
import { LessonRow } from "./lesson-row";

export function EstruturasSection({ group }: { group: MarketViewGroup }) {
  if (group.lessons.length === 0) return null;

  return (
    <Panel title={group.title}>
      <div className="flex flex-col">
        {group.lessons.map((row) => (
          <LessonRow key={row.lesson.id} lesson={row.lesson} status={row.status} />
        ))}
      </div>
    </Panel>
  );
}
