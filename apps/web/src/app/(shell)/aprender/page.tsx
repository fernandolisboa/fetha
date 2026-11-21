import type { Metadata } from "next";

import { getDb } from "@/db/client";
import { forCurrentUser, requireUser } from "@/modules/auth";
import {
  ContinueCard,
  jornadaGroups,
  jornadaOrder,
  LessonProgressRepository,
  LevelSection,
  nextLesson,
  t,
  temasGroups,
  TopicSection,
  toProgressMap,
  ViewSwitch,
  type LessonsView,
} from "@/modules/learning";
import { PageHeader, t as shellStrings } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.learn}` };

function columns<T>(items: readonly T[]): [T[], T[]] {
  const half = Math.ceil(items.length / 2);
  return [items.slice(0, half), items.slice(half)];
}

export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;
  const view: LessonsView = params.ver === "temas" ? "temas" : "jornada";

  const repository = await forCurrentUser(getDb(), LessonProgressRepository);
  const rows = await repository.findAll();
  const progress = toProgressMap(rows, jornadaOrder());
  const recommended = nextLesson(progress);

  return (
    <div className="flex flex-col gap-8 px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader overline={t.overline} headline={t.headline} />
        <ViewSwitch view={view} />
      </div>

      <ContinueCard lesson={recommended} />

      {view === "jornada" ? (
        <div className="grid items-start gap-[14px] lg:grid-cols-2">
          {columns(jornadaGroups(progress, "pt")).map((column, index) => (
            <div key={index} className="flex min-w-0 flex-col gap-[14px]">
              {column.map((group) => (
                <LevelSection key={group.level} group={group} progress={progress} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid items-start gap-[14px] lg:grid-cols-2">
          {columns(temasGroups(progress, "pt")).map((column, index) => (
            <div key={index} className="flex min-w-0 flex-col gap-[14px]">
              {column.map((group) => (
                <TopicSection key={group.topic} group={group} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
