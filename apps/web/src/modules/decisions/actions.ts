"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { confidenceSchema, sessionDateSchema, thesisClaimSchema } from "@fetha/contracts";
import { decisionKinds } from "@fetha/engine";

import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  forCurrentUser,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";
import { DEFAULT_COST_MODEL } from "@/modules/backtests";
import { ContemplatedOperationNotFoundError, getMyOperation } from "@/modules/portfolio";
import {
  getMySignal,
  getStructures,
  markSignalReadAction,
  SignalNotFoundError,
} from "@/modules/strategies";

import { allowedDecisionKinds, type JournalOriginKind } from "./allowed-kinds";
import {
  DecisionsRepository,
  DuplicateSignalDecisionError,
  InvalidHorizonError,
  type RecordDecisionInput,
} from "./decisions-repository";
import type { DecisionInputs } from "./inputs";
import { todaySaoPauloDate } from "./today-sao-paulo";

const recordInputSchema = z.strictObject({
  originKind: z.enum(["signal", "contemplated_operation"]),
  targetId: z.string().min(1).max(200),
  kind: z.enum(decisionKinds),
  rationale: z.string().trim().min(1).max(2000),
  claim: thesisClaimSchema.nullable(),
  confidence: confidenceSchema,
  horizon: sessionDateSchema,
});

export type RecordDecisionActionInput = z.infer<typeof recordInputSchema>;

export type RecordDecisionResult =
  | { status: "ok"; decisionId: string }
  | {
      status: "error";
      error:
        | "invalid"
        | "not_found"
        | "not_allowed"
        | "duplicate"
        | "horizon_in_past"
        | "rate_limited"
        | "unavailable";
    };

// A decision every user might record a handful of times a day, not a
// bulk-write endpoint: the same shape and window as `operations/save`
// (portfolio's operations-actions.ts).
const RECORD_RATE_LIMIT = { windowSeconds: 60, max: 20 };

class KindNotAllowedError extends Error {
  constructor() {
    super("This decision kind is not allowed for this origin");
    this.name = "KindNotAllowedError";
  }
}

export async function recordDecisionAction(
  input: RecordDecisionActionInput,
): Promise<RecordDecisionResult> {
  const parsed = recordInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }
  const { originKind, targetId, kind, rationale, claim, confidence, horizon } = parsed.data;

  // Checked before touching the database (round 2, correctness finding 2):
  // a horizon that was valid when the form loaded but has since crossed
  // into yesterday (or a client that skips its own validation) gets a
  // typed, friendly result here rather than an unhandled 23514 from the
  // `decisions_horizon_on_or_after_decided_check` constraint, which stays
  // in place as the hard guarantee behind this soft check.
  if (horizon < todaySaoPauloDate()) {
    return { status: "error", error: "horizon_in_past" };
  }

  try {
    const decisionId = await withAuthenticatedAction(async () => {
      const user = await requireUser();
      await enforceAccountRateLimit(getDb(), user.email, "decisions/record", RECORD_RATE_LIMIT);

      const repository = await forCurrentUser(getDb(), DecisionsRepository);

      const { recordInput, markSignalIdWhenAnswered } = await buildRecordInput({
        originKind,
        targetId,
        kind,
        rationale,
        claim,
        confidence,
        horizon,
      });

      const recorded = await repository.record(recordInput);

      if (markSignalIdWhenAnswered) {
        // Not the same transaction as the insert above (round 2 item 8):
        // `markSignalReadAction` only reaches `SignalsRepository` through
        // strategies' own entry point, which takes no transaction handle,
        // and widening the shared `UserScopedRepository`'s `db` parameter
        // to accept one so every module's repository could join a
        // cross-module transaction is a much bigger change than this
        // ticket's scope. The failure mode this would guard is narrow: the
        // journal (the source of truth `SignalRow` renders from) already
        // has the decision either way, so a mark-read failure only ever
        // leaves the unread *count* briefly stale, never a duplicate or
        // lost decision — swallowed here rather than turning an already-
        // recorded decision into a thrown error for the user.
        await markSignalReadAction({ signalId: markSignalIdWhenAnswered }).catch(() => undefined);
      }

      return recorded.id;
    });

    revalidatePath("/sinais");
    revalidatePath("/carteira");
    revalidatePath("/diario");
    return { status: "ok", decisionId };
  } catch (error) {
    if (
      error instanceof SignalNotFoundError ||
      error instanceof ContemplatedOperationNotFoundError
    ) {
      return { status: "error", error: "not_found" };
    }
    if (error instanceof KindNotAllowedError) {
      return { status: "error", error: "not_allowed" };
    }
    if (error instanceof DuplicateSignalDecisionError) {
      return { status: "error", error: "duplicate" };
    }
    if (error instanceof InvalidHorizonError) {
      return { status: "error", error: "horizon_in_past" };
    }
    if (error instanceof AccountRateLimitExceededError) {
      return { status: "error", error: "rate_limited" };
    }
    throw error;
  }
}

interface BuildRecordInputArgs {
  originKind: JournalOriginKind;
  targetId: string;
  kind: (typeof decisionKinds)[number];
  rationale: string;
  claim: RecordDecisionActionInput["claim"];
  confidence: RecordDecisionActionInput["confidence"];
  horizon: RecordDecisionActionInput["horizon"];
}

async function buildRecordInput({
  originKind,
  targetId,
  kind,
  rationale,
  claim,
  confidence,
  horizon,
}: BuildRecordInputArgs): Promise<{
  recordInput: RecordDecisionInput;
  markSignalIdWhenAnswered: string | null;
}> {
  if (originKind === "signal") {
    const signal = await getMySignal(targetId);
    if (!allowedDecisionKinds({ kind: "signal", signalKind: signal.kind }).includes(kind)) {
      throw new KindNotAllowedError();
    }
    const inputs: DecisionInputs = {
      originKind: "signal",
      strategyName: signal.strategyName,
      ticker: signal.ticker,
      session: signal.session,
      kind: signal.kind,
      indicators: signal.indicators,
      proposal: signal.proposal,
      rule: signal.rule,
    };
    return {
      recordInput: {
        kind,
        originKind: "signal",
        signalId: signal.id,
        contemplatedOperationId: null,
        strategyVersionId: signal.strategyVersionId,
        inputs,
        rationale,
        claim,
        confidence,
        horizon,
        costModel: DEFAULT_COST_MODEL,
      },
      markSignalIdWhenAnswered: signal.id,
    };
  }

  const operation = await getMyOperation(targetId);
  if (!allowedDecisionKinds({ kind: "contemplated_operation" }).includes(kind)) {
    throw new KindNotAllowedError();
  }
  const structures = await getStructures();
  const structureName =
    structures.find((structure) => structure.id === operation.structureId)?.name ??
    operation.structureId;
  const inputs: DecisionInputs = {
    originKind: "contemplated_operation",
    underlying: operation.underlying,
    structureId: operation.structureId,
    structureName,
    legs: operation.legs,
    session: operation.session,
    netPremiumCentavos: operation.netPremiumCentavos,
    maxLossCentavos: operation.maxLossCentavos,
    maxGainCentavos: operation.maxGainCentavos,
    breachedLimits: operation.breachedLimits,
  };
  return {
    recordInput: {
      kind,
      originKind: "contemplated_operation",
      signalId: null,
      contemplatedOperationId: operation.id,
      strategyVersionId: null,
      inputs,
      rationale,
      claim,
      confidence,
      horizon,
      costModel: DEFAULT_COST_MODEL,
    },
    markSignalIdWhenAnswered: null,
  };
}
