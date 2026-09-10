"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { operationLegSchema, tickerSchema, type OperationLeg } from "@fetha/contracts";
import type { OperationPricing } from "@fetha/engine";

import { getDb } from "@/db/client";
import { forCurrentUser, requireUser, UnauthenticatedError } from "@/modules/auth";
import { optionChainForUnderlying, type ChainSeries } from "@/modules/market-data";
import { RiskProfileRepository } from "@/modules/risk-profile";

import { priceOperationLegs } from "./engine-client";
import { OperationsRepository } from "./operations-repository";

export type PriceOperationActionResult =
  | { status: "ok"; pricing: OperationPricing }
  | { status: "error"; error: "invalid" | "unpriceable" };

export type SaveOperationActionResult =
  { status: "ok"; operationId: string } | { status: "error"; error: "invalid" | "unpriceable" };

const priceInputSchema = z.strictObject({
  underlying: tickerSchema,
  legs: z.array(operationLegSchema).min(1),
});

const saveInputSchema = z.strictObject({
  structureId: z.string().min(1).max(200),
  underlying: tickerSchema,
  legs: z.array(operationLegSchema).min(1),
});

async function currentRiskProfile() {
  const repository = await forCurrentUser(getDb(), RiskProfileRepository);
  return repository.current();
}

export async function loadChainAction(underlying: string): Promise<ChainSeries[]> {
  const parsed = tickerSchema.safeParse(underlying);
  if (!parsed.success) {
    return [];
  }
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/entrar");
    }
    throw error;
  }
  return optionChainForUnderlying(getDb(), parsed.data);
}

export async function priceOperationAction(input: {
  underlying: string;
  legs: OperationLeg[];
}): Promise<PriceOperationActionResult> {
  const parsed = priceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  try {
    const riskProfile = await currentRiskProfile();
    const result = await priceOperationLegs(parsed.data.underlying, parsed.data.legs, riskProfile);
    if (!result.ok) {
      return { status: "error", error: "unpriceable" };
    }
    return { status: "ok", pricing: result.value };
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/entrar");
    }
    throw error;
  }
}

export async function saveOperationAction(input: {
  structureId: string;
  underlying: string;
  legs: OperationLeg[];
}): Promise<SaveOperationActionResult> {
  const parsed = saveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  try {
    const riskProfile = await currentRiskProfile();
    const priced = await priceOperationLegs(parsed.data.underlying, parsed.data.legs, riskProfile);
    if (!priced.ok) {
      return { status: "error", error: "unpriceable" };
    }

    const pricing = priced.value;
    const repository = await forCurrentUser(getDb(), OperationsRepository);
    const saved = await repository.save({
      structureId: parsed.data.structureId,
      underlying: parsed.data.underlying,
      legs: parsed.data.legs,
      session: pricing.at.slice(0, 10),
      netPremiumCentavos: pricing.netPremium,
      maxLossCentavos: pricing.maxLoss === "unbounded" ? null : pricing.maxLoss,
      maxGainCentavos: pricing.maxGain === "unbounded" ? null : pricing.maxGain,
      breachedLimits: pricing.limitBreaches.map((breach) => breach.limit),
    });

    revalidatePath("/carteira");
    return { status: "ok", operationId: saved.id };
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/entrar");
    }
    throw error;
  }
}
