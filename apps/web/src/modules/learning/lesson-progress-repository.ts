import { eq, sql } from "drizzle-orm";

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

  // One atomic upsert, not a read-then-write: two concurrent attempts (two
  // tabs, a slow network retry) must never let the loser's write clobber
  // the winner's. The database itself keeps the better ratio and the
  // earliest pass, via a CASE expression against `excluded` (the row this
  // call tried to insert) and the table's own, pre-update values. A quiz
  // version different from the stored one starts the best score and the
  // pass timestamp over, rather than compare a ratio from a different quiz.
  async recordAttempt(
    lessonId: string,
    lessonVersion: number,
    correct: number,
    total: number,
    passed: boolean,
  ): Promise<void> {
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
          bestCorrect: sql`case
            when ${lessonProgress.lessonVersion} is distinct from excluded.lesson_version then excluded.best_correct
            when excluded.best_correct::float / excluded.total > ${lessonProgress.bestCorrect}::float / ${lessonProgress.total} then excluded.best_correct
            else ${lessonProgress.bestCorrect}
          end`,
          total: sql`case
            when ${lessonProgress.lessonVersion} is distinct from excluded.lesson_version then excluded.total
            when excluded.best_correct::float / excluded.total > ${lessonProgress.bestCorrect}::float / ${lessonProgress.total} then excluded.total
            else ${lessonProgress.total}
          end`,
          firstPassedAt: sql`case
            when ${lessonProgress.lessonVersion} is distinct from excluded.lesson_version then excluded.first_passed_at
            when ${lessonProgress.firstPassedAt} is not null then ${lessonProgress.firstPassedAt}
            else excluded.first_passed_at
          end`,
          updatedAt: new Date(),
        },
      });
  }
}
