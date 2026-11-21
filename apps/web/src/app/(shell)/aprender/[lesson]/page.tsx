import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import { forCurrentUser, requireUser } from "@/modules/auth";
import {
  getLesson,
  jornadaGroups,
  jornadaOrder,
  LessonBlocks,
  loadIllustrativeExamples,
  LessonProgressRepository,
  LevelSection,
  publicQuiz,
  QuizForm,
  toProgressMap,
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
  const lesson = getLesson(lessonId);
  if (!lesson) {
    notFound();
  }

  const [repository, examples] = await Promise.all([
    forCurrentUser(getDb(), LessonProgressRepository),
    loadIllustrativeExamples(),
  ]);
  const rows = await repository.findAll();
  const progress = toProgressMap(rows, jornadaOrder());

  const order = jornadaOrder();
  const position = order.findIndex((candidate) => candidate.id === lesson.id);
  const nextLessonId = order[position + 1]?.id ?? null;

  const levelGroup = jornadaGroups(progress, "pt").find((group) => group.level === lesson.level);

  return (
    <div className="flex flex-col gap-8 px-5 py-8">
      <PageHeader overline={lesson.summary.pt} headline={lesson.title.pt} />

      <div className="@container">
        <div className="grid items-start gap-[14px] @min-[64rem]:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-8">
            <LessonBlocks blocks={lesson.blocks} examples={examples} />
            <QuizForm
              lessonId={lesson.id}
              questions={publicQuiz(lesson, "pt")}
              nextLessonId={nextLessonId}
            />
          </div>

          <div className="flex flex-col gap-[14px] @min-[64rem]:sticky @min-[64rem]:top-4">
            {levelGroup ? (
              <LevelSection group={levelGroup} progress={progress} currentLessonId={lesson.id} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
