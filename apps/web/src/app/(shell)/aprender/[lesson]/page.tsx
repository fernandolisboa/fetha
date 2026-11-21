import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/modules/auth";
import {
  getLesson,
  getMyLessonPage,
  LessonBlocks,
  LevelSection,
  publicQuiz,
  QuizForm,
} from "@/modules/learning";
import { PageHeader } from "@/modules/shell";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lesson: string }>;
}): Promise<Metadata> {
  const { lesson: lessonId } = await params;
  const lesson = getLesson(lessonId);
  return { title: lesson ? `Fetha · ${lesson.title.pt}` : "Fetha" };
}

export default async function LessonPage({ params }: { params: Promise<{ lesson: string }> }) {
  await requireUser();
  const { lesson: lessonId } = await params;
  const page = await getMyLessonPage(lessonId);
  if (!page) {
    notFound();
  }
  const { lesson, examples, progress, position, totalLessons, nextLessonId, levelGroup } = page;

  const overline = `${levelGroup?.title ?? ""} · Lição ${String(position + 1)} de ${String(totalLessons)}`;

  return (
    <div className="flex min-w-0 flex-col gap-8 px-5 py-8">
      <PageHeader overline={overline} headline={lesson.title.pt} />

      <div className="@container">
        <div className="grid min-w-0 items-start gap-[14px] @min-[64rem]:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-8">
            <LessonBlocks blocks={lesson.blocks} examples={examples} />
            <div className="max-w-[72ch]">
              <QuizForm
                lessonId={lesson.id}
                questions={publicQuiz(lesson, "pt", examples)}
                nextLessonId={nextLessonId}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-[14px] @min-[64rem]:sticky @min-[64rem]:top-4">
            {levelGroup ? (
              <LevelSection group={levelGroup} progress={progress} currentLessonId={lesson.id} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
