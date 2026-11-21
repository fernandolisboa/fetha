import type { Metadata } from "next";

import { requireUser } from "@/modules/auth";
import {
  ContinueCard,
  getMyLessonsOverview,
  LessonGroupSection,
  LevelSection,
  t,
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
  const view: LessonsView =
    params.ver === "temas" ? "temas" : params.ver === "estruturas" ? "estruturas" : "jornada";

  const { progress, jornadaGroups, temasGroups, estruturasGroups, recommended } =
    await getMyLessonsOverview();

  return (
    <div className="flex flex-col gap-8 px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader overline={t.overline} headline={t.headline} />
        <ViewSwitch view={view} />
      </div>

      <ContinueCard lesson={recommended} />

      {view === "jornada" ? (
        <div className="grid items-start gap-[14px] lg:grid-cols-2">
          {columns(jornadaGroups).map((column, index) => (
            <div key={index} className="flex min-w-0 flex-col gap-[14px]">
              {column.map((group) => (
                <LevelSection key={group.level} group={group} progress={progress} />
              ))}
            </div>
          ))}
        </div>
      ) : view === "temas" ? (
        <div className="grid items-start gap-[14px] lg:grid-cols-2">
          {columns(temasGroups).map((column, index) => (
            <div key={index} className="flex min-w-0 flex-col gap-[14px]">
              {column.map((group) => (
                <LessonGroupSection key={group.topic} group={group} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid items-start gap-[14px] lg:grid-cols-2">
          {columns(estruturasGroups).map((column, index) => (
            <div key={index} className="flex min-w-0 flex-col gap-[14px]">
              {column.map((group) => (
                <LessonGroupSection key={group.view} group={group} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
