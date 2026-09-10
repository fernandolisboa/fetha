"use server";

import { revalidatePath } from "next/cache";
import { riskProfileSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { forCurrentUser, withAuthenticatedAction } from "@/modules/auth";

import { RiskProfileRepository } from "./risk-profile-repository";

export type RiskProfileActionResult = { status: "ok" } | { status: "error" };

export async function declareRiskProfileAction(input: unknown): Promise<RiskProfileActionResult> {
  const parsed = riskProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" };
  }

  await withAuthenticatedAction(async () => {
    const repository = await forCurrentUser(getDb(), RiskProfileRepository);
    await repository.declare(parsed.data);
  });

  revalidatePath("/configuracoes");
  revalidatePath("/carteira/nova-operacao");
  return { status: "ok" };
}
