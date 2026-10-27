import { eq } from "drizzle-orm";

import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import {
  analysisRequests,
  analysisResults,
  analysisScores,
  decisions,
  decisionScores,
  researchIdeas,
  researchIdeaScores,
  suggestionResearches,
} from "./schema";

export class DecisionsDataExport extends UserScopedRepository {
  async tables(): Promise<DataExportTables> {
    const [
      ownDecisions,
      scores,
      requests,
      results,
      analysisScoreRows,
      researches,
      ideas,
      ideaScores,
    ] = await Promise.all([
      this.db.select().from(decisions).where(eq(decisions.userId, this.userId)),
      this.db.select().from(decisionScores).where(eq(decisionScores.userId, this.userId)),
      this.db.select().from(analysisRequests).where(eq(analysisRequests.userId, this.userId)),
      this.db.select().from(analysisResults).where(eq(analysisResults.userId, this.userId)),
      this.db.select().from(analysisScores).where(eq(analysisScores.userId, this.userId)),
      this.db
        .select()
        .from(suggestionResearches)
        .where(eq(suggestionResearches.userId, this.userId)),
      this.db.select().from(researchIdeas).where(eq(researchIdeas.userId, this.userId)),
      this.db.select().from(researchIdeaScores).where(eq(researchIdeaScores.userId, this.userId)),
    ]);
    return {
      decisions: ownDecisions,
      decision_scores: scores,
      analysis_requests: requests,
      analysis_results: results,
      analysis_scores: analysisScoreRows,
      suggestion_researches: researches,
      research_ideas: ideas,
      research_idea_scores: ideaScores,
    };
  }
}
