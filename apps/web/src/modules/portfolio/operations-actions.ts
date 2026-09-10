"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { contemplatedLegSchema, tickerSchema, type ContemplatedLeg } from "@fetha/contracts";
import type { OperationPricing } from "@fetha/engine";

import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  forCurrentUser,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";
import {
  latestSessionOnOrBefore,
  optionChainForUnderlying,
  type ChainSeries,
} from "@/modules/market-data";
import { getStructures } from "@/modules/strategies";

import { priceOperationLegs } from "./engine-client";
import { OperationsRepository } from "./operations-repository";
import { RiskProfileRepository } from "./risk-profile-repository";
import { validateLegsAgainstStructure } from "./validate-legs";

export type PriceOperationActionResult =
  | { status: "ok"; pricing: OperationPricing }
  | { status: "error"; error: "invalid" | "unpriceable" | "rate_limited" };

export type SaveOperationActionResult =
  | { status: "ok"; operationId: string; pricing: OperationPricing }
  | { status: "error"; error: "invalid" | "unpriceable" | "rate_limited" };

const MAX_LEGS = 8;

const priceInputSchema = z.strictObject({
  underlying: tickerSchema,
  legs: z.array(contemplatedLegSchema).min(1).max(MAX_LEGS),
});

const saveInputSchema = z.strictObject({
  structureId: z.string().min(1).max(200),
  underlying: tickerSchema,
  legs: z.array(contemplatedLegSchema).min(1).max(MAX_LEGS),
});

const PRICE_RATE_LIMIT = { windowSeconds: 10, max: 30 };
const SAVE_RATE_LIMIT = { windowSeconds: 60, max: 20 };

async function currentRiskProfile() {
  const repository = await forCurrentUser(getDb(), RiskProfileRepository);
  return repository.current();
}

async function currentSessionDate(): Promise<string | null> {
  const session = await latestSessionOnOrBefore(getDb(), new Date());
  return session?.date ?? null;
}

export async function loadChainAction(underlying: string): Promise<ChainSeries[]> {
  const parsed = tickerSchema.safeParse(underlying);
  if (!parsed.success) {
    return [];
  }
  return withAuthenticatedAction(async () => {
    await requireUser();
    const session = await currentSessionDate();
    if (!session) {
      return [];
    }
    return optionChainForUnderlying(getDb(), parsed.data, session, new Date());
  });
}

// structureId and the legs' role/side/expiry/strike-rank shape are
// resolved against the catalog before either action ever calls the engine
// (round 1 item 10): an unknown structure id or a leg set that does not
// match its template (a "collar" with the put strike above the call's, a
// bull spread priced as a bear spread) is rejected here, not surfaced as a
// raw foreign-key error or a silently mispriced structure.
async function resolveAndValidateLegs(
  underlying: string,
  structureId: string,
  legs: ContemplatedLeg[],
): Promise<{ ok: true } | { ok: false }> {
  const structures = await getStructures();
  const structure = structures.find((candidate) => candidate.id === structureId);
  if (!structure) {
    return { ok: false };
  }
  const session = await currentSessionDate();
  const chain = session
    ? await optionChainForUnderlying(getDb(), underlying, session, new Date())
    : [];
  const result = validateLegsAgainstStructure(structure, legs, chain);
  return result.ok ? { ok: true } : { ok: false };
}

export async function priceOperationAction(input: {
  underlying: string;
  legs: ContemplatedLeg[];
}): Promise<PriceOperationActionResult> {
  const parsed = priceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    try {
      await enforceAccountRateLimit(getDb(), user.email, "operations/price", PRICE_RATE_LIMIT);
    } catch (error) {
      if (error instanceof AccountRateLimitExceededError) {
        return { status: "error", error: "rate_limited" };
      }
      throw error;
    }

    const riskProfile = await currentRiskProfile();
    const result = await priceOperationLegs(parsed.data.underlying, parsed.data.legs, riskProfile);
    if (!result.ok) {
      return { status: "error", error: "unpriceable" };
    }
    return { status: "ok", pricing: result.value };
  });
}

export async function saveOperationAction(input: {
  structureId: string;
  underlying: string;
  legs: ContemplatedLeg[];
}): Promise<SaveOperationActionResult> {
  const parsed = saveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    try {
      await enforceAccountRateLimit(getDb(), user.email, "operations/save", SAVE_RATE_LIMIT);
    } catch (error) {
      if (error instanceof AccountRateLimitExceededError) {
        return { status: "error", error: "rate_limited" };
      }
      throw error;
    }

    const validated = await resolveAndValidateLegs(
      parsed.data.underlying,
      parsed.data.structureId,
      parsed.data.legs,
    );
    if (!validated.ok) {
      return { status: "error", error: "invalid" };
    }

    const riskProfile = await currentRiskProfile();
    const priced = await priceOperationLegs(parsed.data.underlying, parsed.data.legs, riskProfile);
    if (!priced.ok) {
      return { status: "error", error: "unpriceable" };
    }

    const pricing = priced.value;
    const session = await latestSessionOnOrBefore(getDb(), new Date(pricing.at));
    if (!session) {
      return { status: "error", error: "unpriceable" };
    }

    const repository = await forCurrentUser(getDb(), OperationsRepository);
    const saved = await repository.save({
      structureId: parsed.data.structureId,
      underlying: parsed.data.underlying,
      legs: parsed.data.legs,
      session: session.date,
      netPremiumCentavos: pricing.netPremium,
      maxLossCentavos: pricing.maxLoss === "unbounded" ? null : pricing.maxLoss,
      maxGainCentavos: pricing.maxGain === "unbounded" ? null : pricing.maxGain,
      breachedLimits: pricing.limitBreaches.map((breach) => breach.limit),
    });

    revalidatePath("/carteira");
    return { status: "ok", operationId: saved.id, pricing };
  });
}
