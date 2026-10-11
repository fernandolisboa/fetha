import { eq } from "drizzle-orm";

import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { analysisRequests, analysisResults, decisions, decisionScores } from "./schema";

export class DecisionsDataExport extends UserScopedRepository {
  async tables(): Promise<DataExportTables> {
    const [ownDecisions, scores, requests, results] = await Promise.all([
      this.db.select().from(decisions).where(eq(decisions.userId, this.userId)),
      this.db.select().from(decisionScores).where(eq(decisionScores.userId, this.userId)),
      this.db.select().from(analysisRequests).where(eq(analysisRequests.userId, this.userId)),
      this.db.select().from(analysisResults).where(eq(analysisResults.userId, this.userId)),
    ]);
    return {
      decisions: ownDecisions,
      decision_scores: scores,
      analysis_requests: requests,
      analysis_results: results,
    };
  }
}
