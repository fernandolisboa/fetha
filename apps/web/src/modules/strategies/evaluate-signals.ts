import { instantSchema, riskProfileSchema, type RiskProfile } from "@fetha/contracts";
import { engine, type Signal, type StrategyVersion } from "@fetha/engine";

import type { Database } from "@/db/client";
import { loadMarketView, sessionByDate } from "@/modules/market-data";
import { WatchlistRepository } from "@/modules/watchlist";

import { activeStrategyUserIds } from "./active-strategy-users";
import { SignalsRepository, type NewEvaluation, type NewSignal } from "./signals-repository";
import { StrategiesRepository } from "./strategies-repository";
import { StructuresRepository } from "./structures-repository";

// Sizing an entry always needs a declared risk profile (packages/engine's
// `sizeStockEntry`: no `declaredCapital` is `unsizeable`, never a signal).
// The portfolio module (#7's later tickets) is where a user declares their
// real capital and limits; until it ships, every user is evaluated against
// this generous, effectively unconstrained placeholder so the nightly
// evaluation can still size and deposit real entry signals rather than
// leaving every strategy permanently `unsizeable`. Replace this with the
// user's own declared profile the day the portfolio module exposes one.
const PLACEHOLDER_RISK_PROFILE: RiskProfile = riskProfileSchema.parse({
  declaredCapital: 100_000_00,
  limits: {
    maxLossPerOperation: "1",
    maxExposurePerOperation: "1",
    maxOpenOperations: 1000,
    maxPremiumBought: "1",
  },
});

export interface EvaluateSignalsOutcome {
  session: string | null;
  usersEvaluated: number;
  signalsWritten: number;
  evaluationsWritten: number;
  errors: string[];
}

function signalToNewSignal(strategyId: string, signal: Signal): NewSignal {
  const base = {
    strategyId,
    strategyVersionId: signal.strategyVersionId,
    ticker: signal.ticker,
    timeframe: signal.timeframe,
    session: signal.session,
    at: new Date(signal.at),
    indicators: signal.indicators,
  };
  if (signal.kind === "entry") {
    return { ...base, kind: "entry", proposal: signal.proposal, operationId: null, rule: null };
  }
  if (signal.kind === "exit") {
    return {
      ...base,
      kind: "exit",
      proposal: null,
      operationId: signal.operationId,
      rule: signal.rule,
    };
  }
  return {
    ...base,
    kind: "adjust",
    proposal: signal.proposal,
    operationId: signal.operationId,
    rule: signal.rule,
  };
}

// Chained after ingestion in the cron, per user, per active daily strategy,
// over that user's watchlist (#19, CONTEXT.md "Nightly ingestion and daily
// evaluation"). `session` is the session `ingest()` just closed; every write
// goes through a SignalsRepository bound to the user it was evaluated for,
// so an evaluation for user A can never land in user B's inbox.
export async function evaluateSignalsForSession(
  db: Database,
  session: string,
): Promise<EvaluateSignalsOutcome> {
  const trading = await sessionByDate(db, session);
  if (!trading) {
    return { session, usersEvaluated: 0, signalsWritten: 0, evaluationsWritten: 0, errors: [] };
  }
  const at = instantSchema.parse(trading.close.toISOString());

  const structures = await new StructuresRepository(db).listAll();
  const structureById = new Map(structures.map((structure) => [structure.id, structure]));

  const userIds = await activeStrategyUserIds(db);

  let usersEvaluated = 0;
  let signalsWritten = 0;
  let evaluationsWritten = 0;
  const errors: string[] = [];

  for (const userId of userIds) {
    const scopedUser = { id: userId };
    try {
      const strategiesRepository = new StrategiesRepository(db, scopedUser);
      const activeDaily = await strategiesRepository.listActiveDaily();
      if (activeDaily.length === 0) {
        continue;
      }

      const watchlist = await new WatchlistRepository(db, scopedUser).list();
      const tickers = watchlist.map((item) => item.ticker);
      if (tickers.length === 0) {
        continue;
      }

      const view = await loadMarketView(db, tickers);
      const signalsRepository = new SignalsRepository(db, scopedUser);

      for (const { strategyId, version } of activeDaily) {
        const structure = structureById.get(version.definition.structureId);
        if (!structure) {
          errors.push(
            `${userId}:${strategyId}: unknown structure ${version.definition.structureId}`,
          );
          continue;
        }
        const strategyVersion: StrategyVersion = {
          id: version.id,
          definition: version.definition,
          structure,
        };

        const result = await engine.evaluateStrategy({
          view,
          strategy: strategyVersion,
          instruments: tickers,
          at,
          riskProfile: PLACEHOLDER_RISK_PROFILE,
        });

        if (!result.ok) {
          errors.push(`${userId}:${strategyId}: ${result.error.code}`);
          continue;
        }

        const newSignals: NewSignal[] = result.value.signals.map((signal) =>
          signalToNewSignal(strategyId, signal),
        );
        const newEvaluations: NewEvaluation[] = result.value.evaluations.map((record) => ({
          strategyId,
          strategyVersionId: version.id,
          ticker: record.ticker,
          session: record.session,
          at: new Date(record.at),
          outcome: record.outcome,
          detail: record.detail,
        }));

        signalsWritten += await signalsRepository.createSignals(newSignals);
        evaluationsWritten += await signalsRepository.createEvaluations(newEvaluations);
      }
      usersEvaluated += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      errors.push(`${userId}: ${message}`);
    }
  }

  return { session, usersEvaluated, signalsWritten, evaluationsWritten, errors };
}
