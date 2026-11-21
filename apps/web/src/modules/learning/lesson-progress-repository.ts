import { and, eq } from "drizzle-orm";

import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { lessonProgress } from "./schema";

export interface LessonProgressRow {
  lessonId: string;
  lessonVersion: number;
  bestCorrect: number;
  total: number;
  passed: boolean;
}

export class LessonProgressRepository extends UserScopedRepository {
  async findAll(): Promise<LessonProgressRow[]> {
    const rows = await this.db
      .select({
        lessonId: lessonProgress.lessonId,
        lessonVersion: lessonProgress.lessonVersion,
        bestCorrect: lessonProgress.bestCorrect,
        total: lessonProgress.total,
        firstPassedAt: lessonProgress.firstPassedAt,
      })
      .from(lessonProgress)
      .where(eq(lessonProgress.userId, this.userId));

    return rows.map((row) => ({
      lessonId: row.lessonId,
      lessonVersion: row.lessonVersion,
      bestCorrect: row.bestCorrect,
      total: row.total,
      passed: row.firstPassedAt !== null,
    }));
  }

  // Records one graded attempt. A new quiz version (the lesson's text or
  // questions changed) starts the best score over, rather than compare a
  // ratio from a different quiz; the same version keeps the better of the
  // two. `firstPassedAt` is set once and never moved, so retrying a passed
  // lesson cannot erase when it was first passed.
  async recordAttempt(
    lessonId: string,
    lessonVersion: number,
    correct: number,
    total: number,
    passed: boolean,
  ): Promise<void> {
    const [existing] = await this.db
      .select({
        lessonVersion: lessonProgress.lessonVersion,
        bestCorrect: lessonProgress.bestCorrect,
        total: lessonProgress.total,
        firstPassedAt: lessonProgress.firstPassedAt,
      })
      .from(lessonProgress)
      .where(and(eq(lessonProgress.userId, this.userId), eq(lessonProgress.lessonId, lessonId)));

    const previous = existing?.lessonVersion === lessonVersion ? existing : undefined;
    const keptBest =
      previous !== undefined && correct / total <= previous.bestCorrect / previous.total
        ? previous
        : { bestCorrect: correct, total };

    await this.db
      .insert(lessonProgress)
      .values({
        userId: this.userId,
        lessonId,
        lessonVersion,
        bestCorrect: correct,
        total,
        firstPassedAt: passed ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [lessonProgress.userId, lessonProgress.lessonId],
        set: {
          lessonVersion,
          bestCorrect: keptBest.bestCorrect,
          total: keptBest.total,
          firstPassedAt: passed
            ? (previous?.firstPassedAt ?? new Date())
            : (previous?.firstPassedAt ?? null),
          updatedAt: new Date(),
        },
      });
  }
}
