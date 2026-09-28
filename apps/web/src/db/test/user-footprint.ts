import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { accessLog } from "@/modules/audit/schema";
import { account, invites, session, termsAcceptances, user } from "@/modules/auth/schema";
import { backtestRuns } from "@/modules/backtests/schema";
import { decisions, decisionScores } from "@/modules/decisions/schema";
import {
  contemplatedOperations,
  fills,
  operations,
  riskProfiles,
} from "@/modules/portfolio/schema";
import { preferences } from "@/modules/preferences/schema";
import {
  evaluations,
  signalReevaluations,
  signals,
  strategies,
  strategyVersions,
} from "@/modules/strategies/schema";
import { watchlistItems } from "@/modules/watchlist/schema";

function only<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) {
    throw new Error("footprint insert returned no row");
  }
  return row;
}

export interface UserFootprint {
  strategyId: string;
  strategyVersionId: string;
}

async function seedAuthRows(db: Database, userId: string, tag: string, at: Date): Promise<void> {
  await db.insert(session).values({
    id: `session-${tag}`,
    token: `token-${tag}`,
    expiresAt: new Date(at.getTime() + 60_000),
    updatedAt: at,
    ipAddress: "203.0.113.7",
    userAgent: "footprint",
    userId,
  });
  await db.insert(account).values({
    id: `account-${tag}`,
    accountId: userId,
    providerId: "credential",
    password: `hash-${tag}`,
    updatedAt: at,
    userId,
  });
}

// One row in every table that holds a user's data, inserted directly: the
// LGPD export and deletion tests (docs/adr/0027) need breadth, not realistic
// payloads, so jsonb columns carry placeholders no reader parses here.
// `withAuthRows: false` leaves `session` and `account` alone, for a user who
// already signed up for real and must keep a working password.
export async function seedUserFootprint(
  db: Database,
  owner: ScopedUser,
  { withAuthRows = true }: { withAuthRows?: boolean } = {},
): Promise<UserFootprint> {
  const userId = owner.id;
  const tag = crypto.randomUUID();
  const at = new Date();

  if (withAuthRows) {
    await seedAuthRows(db, userId, tag, at);
  }
  await db.insert(termsAcceptances).values({ userId, termsVersion: "footprint" });
  const [profile] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
  await db
    .insert(invites)
    .values({
      email: profile?.email ?? `${tag}@example.com`,
      consumedAt: at,
      consumedByUserId: userId,
    })
    .onConflictDoNothing();
  await db.insert(accessLog).values({ userId, event: "portfolio_read" });
  await db.insert(preferences).values({ userId });
  await db.insert(watchlistItems).values({ userId, ticker: "PETR4" });

  const strategy = only(
    await db
      .insert(strategies)
      .values({ userId, name: `footprint-${tag}`, visibility: "shared" })
      .returning({ id: strategies.id }),
  );
  const version = only(
    await db
      .insert(strategyVersions)
      .values({
        strategyId: strategy.id,
        versionNumber: 1,
        definition: {} as never,
        definitionDigest: tag,
      })
      .returning({ id: strategyVersions.id }),
  );
  const strategyId = strategy.id;
  const strategyVersionId = version.id;

  const reevaluation = only(
    await db
      .insert(signalReevaluations)
      .values({ userId, strategyId, session: "2026-09-25", status: "applied" })
      .returning({ id: signalReevaluations.id }),
  );
  const signal = only(
    await db
      .insert(signals)
      .values({
        userId,
        strategyId,
        strategyVersionId,
        ticker: "PETR4",
        timeframe: "1d",
        session: "2026-09-25",
        at,
        kind: "entry",
        indicators: [],
        reevaluationId: reevaluation.id,
      })
      .returning({ id: signals.id }),
  );
  // A superseded row pointing at the re-evaluation, so account deletion is
  // proven over the links a real re-evaluation leaves (docs/adr/0045).
  await db.insert(evaluations).values([
    {
      userId,
      strategyId,
      strategyVersionId,
      ticker: "PETR4",
      session: "2026-09-25",
      at,
      outcome: "no_signal",
      supersededBy: reevaluation.id,
    },
    {
      userId,
      strategyId,
      strategyVersionId,
      ticker: "PETR4",
      session: "2026-09-25",
      at,
      outcome: "signal",
      reevaluationId: reevaluation.id,
    },
  ]);

  const contemplated = only(
    await db
      .insert(contemplatedOperations)
      .values({
        userId,
        structureId: "stock",
        underlying: "PETR4",
        legs: [],
        session: "2026-09-25",
        netPremiumCentavos: 0,
      })
      .returning({ id: contemplatedOperations.id }),
  );
  await db
    .insert(riskProfiles)
    .values({ userId, declaredCapital: 10_000_000, limits: {} as never });
  const operation = only(
    await db
      .insert(operations)
      .values({ userId, underlying: "PETR4", status: "open", openedAt: "2026-09-25" })
      .returning({ id: operations.id }),
  );
  await db.insert(fills).values({
    userId,
    ticker: "PETR4",
    assetClass: "stock",
    side: "buy",
    quantity: 100,
    price: "30.00",
    session: "2026-09-25",
    source: "manual",
    operationId: operation.id,
  });

  await db.insert(backtestRuns).values({
    userId,
    strategyId,
    strategyVersionId,
    structure: {} as never,
    universe: ["PETR4"],
    periodFrom: "2026-01-02",
    periodTo: "2026-09-25",
    initialCapital: 10_000_000,
    costModel: {} as never,
    riskProfile: {} as never,
    limits: "enforce",
    seed: 1,
    configDigest: tag,
  });

  const decisionBase = {
    userId,
    kind: "enter",
    inputs: {} as never,
    rationale: "footprint",
    confidence: "0.5",
    horizon: "2099-01-01",
    costModel: {} as never,
  };
  const signalDecision = only(
    await db
      .insert(decisions)
      .values({ ...decisionBase, originKind: "signal", signalId: signal.id, strategyVersionId })
      .returning({ id: decisions.id }),
  );
  await db.insert(decisions).values({
    ...decisionBase,
    originKind: "contemplated_operation",
    contemplatedOperationId: contemplated.id,
  });
  await db.insert(decisions).values({
    ...decisionBase,
    kind: "hold",
    originKind: "held_operation",
    operationId: operation.id,
  });
  await db.insert(decisionScores).values({
    userId,
    decisionId: signalDecision.id,
    unscorableReason: "footprint",
    engineVersion: "footprint",
  });

  return { strategyId, strategyVersionId };
}
