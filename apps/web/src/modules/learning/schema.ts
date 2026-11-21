import { pgTable, text, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";

import { user } from "../auth/schema";

// One row per user per lesson: the best score ever reached on that lesson's
// current quiz version, and when it was first passed (ADR-0081). Lesson
// progress is not portfolio or decision data, so it is outside the audit
// log's scope (CONTEXT.md, principle 6); it still ships in the account
// export and is deleted with the account via the user FK cascade.
export const lessonProgress = pgTable(
  "lesson_progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id").notNull(),
    lessonVersion: integer("lesson_version").notNull(),
    bestCorrect: integer("best_correct").notNull(),
    total: integer("total").notNull(),
    firstPassedAt: timestamp("first_passed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.lessonId] })],
);
