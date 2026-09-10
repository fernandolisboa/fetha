"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { centavosSchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { requireUser, UnauthenticatedError } from "@/modules/auth";
import { StrategiesRepository, StrategyNotFoundError } from "@/modules/strategies";
import { WatchlistRepository } from "@/modules/watchlist";

import { BacktestRunRepository } from "./backtest-run-repository";
import { DEFAULT_COST_MODEL, defaultRiskProfile } from "./default-config";

export type CreateBacktestRunResult = { status: "error"; error: "invalid" | "not_found" };

const createInputSchema = z.strictObject({
  strategyId: z.string().min(1).max(200),
  strategyVersionId: z.string().min(1).max(200),
  universe: z.array(tickerSchema).min(1).max(50),
  from: sessionDateSchema,
  to: sessionDateSchema,
  initialCapital: centavosSchema.positive(),
  limits: z.enum(["enforce", "warn"]),
});

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
}

export async function createBacktestRunAction(input: unknown): Promise<CreateBacktestRunResult> {
  const parsed = createInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }
  if (parsed.data.from >= parsed.data.to) {
    return { status: "error", error: "invalid" };
  }

  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/entrar");
    }
    throw error;
  }

  const db = getDb();
  const watchlist = await new WatchlistRepository(db, user).list();
  const watchlistTickers = new Set(watchlist.map((item) => item.ticker));
  if (!parsed.data.universe.every((ticker) => watchlistTickers.has(ticker))) {
    return { status: "error", error: "invalid" };
  }

  const strategy = await new StrategiesRepository(db, user)
    .findMine(parsed.data.strategyId)
    .catch((error: unknown) => {
      if (error instanceof StrategyNotFoundError) return null;
      throw error;
    });
  const version = strategy?.versions.find((v) => v.id === parsed.data.strategyVersionId);
  if (!strategy || !version) {
    return { status: "error", error: "not_found" };
  }

  const run = await new BacktestRunRepository(db, user).create({
    strategyId: strategy.id,
    strategyVersionId: version.id,
    universe: parsed.data.universe,
    period: { from: parsed.data.from, to: parsed.data.to },
    initialCapital: parsed.data.initialCapital,
    costModel: DEFAULT_COST_MODEL,
    riskProfile: defaultRiskProfile(parsed.data.initialCapital),
    limits: parsed.data.limits,
    sizing: version.definition.sizing,
    seed: randomSeed(),
  });

  redirect(`/estrategias/${strategy.id}/backtests/${run.id}`);
}
