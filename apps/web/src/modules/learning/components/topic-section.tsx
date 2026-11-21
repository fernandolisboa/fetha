import { Panel } from "@/modules/shell/client";

import type { TopicGroup } from "../grouping";
import { LessonRow } from "./lesson-row";

export function TopicSection({ group }: { group: TopicGroup }) {
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
