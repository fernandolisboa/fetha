"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { riskProfileSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { forCurrentUser, UnauthenticatedError } from "@/modules/auth";

import { RiskProfileRepository } from "./risk-profile-repository";

export type RiskProfileActionResult = { status: "ok" } | { status: "error" };

export async function declareRiskProfileAction(input: unknown): Promise<RiskProfileActionResult> {
  const parsed = riskProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" };
  }

  try {
    const repository = await forCurrentUser(getDb(), RiskProfileRepository);
    await repository.declare(parsed.data);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/entrar");
    }
    throw error;
  }

  revalidatePath("/configuracoes");
  revalidatePath("/carteira/nova-operacao");
  return { status: "ok" };
}
