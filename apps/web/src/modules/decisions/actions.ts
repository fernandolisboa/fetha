"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { confidenceSchema, sessionDateSchema, thesisClaimSchema } from "@fetha/contracts";
import { decisionKinds } from "@fetha/engine";

import { getDb } from "@/db/client";
import { forCurrentUser, withAuthenticatedAction } from "@/modules/auth";
import { DEFAULT_COST_MODEL } from "@/modules/backtests";
import { ContemplatedOperationNotFoundError, getMyOperation } from "@/modules/portfolio";
import { getMySignal, markSignalReadAction, SignalNotFoundError } from "@/modules/strategies";

import { allowedDecisionKinds, type DecisionOriginKind } from "./allowed-kinds";
import {
  DecisionsRepository,
  DuplicateSignalDecisionError,
  type RecordDecisionInput,
} from "./decisions-repository";
import type { DecisionInputs } from "./inputs";

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
      error: "invalid" | "not_found" | "not_allowed" | "duplicate" | "unavailable";
    };

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

  try {
    const decisionId = await withAuthenticatedAction(async () => {
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
        await markSignalReadAction({ signalId: markSignalIdWhenAnswered });
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
    throw error;
  }
}

interface BuildRecordInputArgs {
  originKind: DecisionOriginKind;
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
  const inputs: DecisionInputs = {
    originKind: "contemplated_operation",
    underlying: operation.underlying,
    structureId: operation.structureId,
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
