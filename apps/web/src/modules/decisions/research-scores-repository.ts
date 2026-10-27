import { and, asc, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import {
  analysisVerdicts,
  tickerSchema,
  sessionDateSchema,
  thesisClaimSchema,
  type AnalysisVerdictDecision,
  type SessionDate,
  type ThesisClaim,
} from "@fetha/contracts";
import type { OperationLeg, Score } from "@fetha/engine";
import { z } from "zod";

import { UserScopedRepository } from "@/lib/user-scoped-repository";
import { lotLegsSchema } from "@/modules/radar";

import { researchIdeaScores, researchIdeas, suggestionResearches } from "./schema";

export type NewResearchIdeaScore =
  | {
      ideaId: string;
      score: Score;
      unscorableReason?: undefined;
      claimHeld: boolean | null;
      pnlCentavos: number | null;
      maxLossCentavos: number | null;
      normalizedPnl: string | null;
      engineVersion: string;
    }
  | {
      ideaId: string;
      score?: undefined;
      unscorableReason: string;
      engineVersion: string;
    };

export interface DueResearchIdea {
  id: string;
  underlying: string;
  newestClose: SessionDate;
  horizon: SessionDate;
  claim: ThesisClaim;
  legs: OperationLeg[];
}

// `invalid`: due ideas whose stored jsonb no longer parses; the scorer settles them as terminal
// instead of leaving them due every night.
export interface DueResearch {
  due: DueResearchIdea[];
  invalid: string[];
}

export interface ResearchScoreRow {
  ideaId: string;
  verdict: AnalysisVerdictDecision;
  unscorableReason: string | null;
  claimHeld: boolean | null;
  pnlCentavos: number | null;
}

const verdictSchema = z.enum(analysisVerdicts);

// Written only by the nightly job, built with the id `dueResearchUserIds` returned, never an id a
// user-reachable path could pass in; the composite foreign key on `(idea_id, user_id)` rejects a
// score naming another user's idea.
export class ResearchScoresRepository extends UserScopedRepository {
  async insertIfAbsent(input: NewResearchIdeaScore): Promise<{ inserted: boolean }> {
    const rows = await this.db
      .insert(researchIdeaScores)
      .values({
        userId: this.userId,
        ideaId: input.ideaId,
        score: input.score ?? null,
        unscorableReason: input.unscorableReason ?? null,
        claimHeld: input.score ? input.claimHeld : null,
        pnlCentavos: input.score ? input.pnlCentavos : null,
        maxLossCentavos: input.score ? input.maxLossCentavos : null,
        normalizedPnl: input.score ? input.normalizedPnl : null,
        engineVersion: input.engineVersion,
      })
      .onConflictDoNothing({ target: researchIdeaScores.ideaId })
      .returning({ id: researchIdeaScores.id });
    return { inserted: rows.length > 0 };
  }

  async dueForUser(asOfSession: string): Promise<DueResearch> {
    const rows = await this.db
      .select({ idea: researchIdeas })
      .from(researchIdeas)
      .leftJoin(researchIdeaScores, eq(researchIdeaScores.ideaId, researchIdeas.id))
      .where(
        and(
          eq(researchIdeas.userId, this.userId),
          lte(researchIdeas.horizon, asOfSession),
          isNull(researchIdeaScores.id),
        ),
      )
      .orderBy(asc(researchIdeas.horizon), asc(researchIdeas.id));

    const due: DueResearchIdea[] = [];
    const invalid: string[] = [];
    for (const { idea } of rows) {
      const legs = lotLegsSchema.safeParse(idea.legs);
      const claim = thesisClaimSchema.safeParse(idea.claim);
      const newestClose = sessionDateSchema.safeParse(idea.newestClose);
      const horizon = sessionDateSchema.safeParse(idea.horizon);
      if (!legs.success || !claim.success || !newestClose.success || !horizon.success) {
        invalid.push(idea.id);
        continue;
      }
      due.push({
        id: idea.id,
        underlying: idea.underlying,
        newestClose: newestClose.data,
        horizon: horizon.data,
        claim: claim.data,
        legs: legs.data.map(({ role, side, ticker, quantity, price }) => ({
          role,
          side,
          ticker: tickerSchema.parse(ticker),
          quantity,
          entryPrice: price,
        })),
      });
    }
    return { due, invalid };
  }

  async findForIdeas(ideaIds: readonly string[]): Promise<Map<string, ResearchScoreRow>> {
    if (ideaIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        ideaId: researchIdeaScores.ideaId,
        verdict: researchIdeas.verdict,
        unscorableReason: researchIdeaScores.unscorableReason,
        claimHeld: researchIdeaScores.claimHeld,
        pnlCentavos: researchIdeaScores.pnlCentavos,
      })
      .from(researchIdeaScores)
      .innerJoin(
        researchIdeas,
        and(eq(researchIdeas.id, researchIdeaScores.ideaId), eq(researchIdeas.userId, this.userId)),
      )
      .where(
        and(
          eq(researchIdeaScores.userId, this.userId),
          inArray(researchIdeaScores.ideaId, [...ideaIds]),
        ),
      );
    return new Map(
      rows.flatMap((row) => {
        const verdict = verdictSchema.safeParse(row.verdict);
        return verdict.success ? [[row.ideaId, { ...row, verdict: verdict.data }] as const] : [];
      }),
    );
  }

  // The journal's "Pesquisas do Fetha" rows (docs/adr/0076): the scores of this user's ideas,
  // scored or unscorable, with the verdict each judges. Asking again at the same close stores
  // the same lots again; only the latest research of each close counts, so one market state is
  // not counted once per click.
  async allMine(): Promise<ResearchScoreRow[]> {
    const [rows, researches] = await Promise.all([
      this.db
        .select({
          ideaId: researchIdeaScores.ideaId,
          researchId: researchIdeas.researchId,
          verdict: researchIdeas.verdict,
          unscorableReason: researchIdeaScores.unscorableReason,
          claimHeld: researchIdeaScores.claimHeld,
          pnlCentavos: researchIdeaScores.pnlCentavos,
        })
        .from(researchIdeaScores)
        .innerJoin(
          researchIdeas,
          and(
            eq(researchIdeas.id, researchIdeaScores.ideaId),
            eq(researchIdeas.userId, this.userId),
          ),
        )
        .where(eq(researchIdeaScores.userId, this.userId)),
      this.db
        .select({
          id: suggestionResearches.id,
          newestClose: suggestionResearches.newestClose,
        })
        .from(suggestionResearches)
        .where(eq(suggestionResearches.userId, this.userId))
        .orderBy(desc(suggestionResearches.createdAt), desc(suggestionResearches.id)),
    ]);
    const latestAtClose = new Map<string, string>();
    for (const research of researches) {
      if (!latestAtClose.has(research.newestClose)) {
        latestAtClose.set(research.newestClose, research.id);
      }
    }
    const latest = new Set(latestAtClose.values());
    return rows.flatMap(({ researchId, ...row }) => {
      const verdict = verdictSchema.safeParse(row.verdict);
      return verdict.success && latest.has(researchId) ? [{ ...row, verdict: verdict.data }] : [];
    });
  }
}
