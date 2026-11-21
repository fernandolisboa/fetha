import { eq } from "drizzle-orm";

import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { lessonProgress } from "./schema";

export class LessonProgressDataExport extends UserScopedRepository {
  async tables(): Promise<DataExportTables> {
    return {
      lesson_progress: await this.db
        .select()
        .from(lessonProgress)
        .where(eq(lessonProgress.userId, this.userId)),
    };
  }
}
