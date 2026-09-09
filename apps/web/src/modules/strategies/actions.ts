"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { strategyDefinitionSchema, type StrategyDefinition } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { forCurrentUser, UnauthenticatedError } from "@/modules/auth";

import {
  StrategiesRepository,
  StrategyNotFoundError,
  StrategyNotSharedError,
} from "./strategies-repository";

export type StrategyActionResult =
  | { status: "ok"; strategyId: string }
  | { status: "error"; error: "invalid" | "not_found" | "not_shared" };

const createInputSchema = z.strictObject({
  name: z.string().min(1),
  definition: strategyDefinitionSchema,
});

const addVersionInputSchema = z.strictObject({
  strategyId: z.string().min(1),
  definition: strategyDefinitionSchema,
});

const shareInputSchema = z.strictObject({
  strategyId: z.string().min(1),
  visibility: z.enum(["private", "shared"]),
});

const copyInputSchema = z.strictObject({
  sourceStrategyId: z.string().min(1),
});

async function withRepository<T>(
  run: (repository: StrategiesRepository) => Promise<T>,
): Promise<T> {
  try {
    const repository = await forCurrentUser(getDb(), StrategiesRepository);
    return await run(repository);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/entrar");
    }
    throw error;
  }
}

export async function createStrategyAction(input: {
  name: string;
  definition: StrategyDefinition;
}): Promise<StrategyActionResult> {
  const parsed = createInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  const created = await withRepository((repository) =>
    repository.createWithVersion(parsed.data.name, parsed.data.definition),
  );

  revalidatePath("/estrategias");
  return { status: "ok", strategyId: created.id };
}

export async function addStrategyVersionAction(input: {
  strategyId: string;
  definition: StrategyDefinition;
}): Promise<StrategyActionResult> {
  const parsed = addVersionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  try {
    const updated = await withRepository((repository) =>
      repository.addVersion(parsed.data.strategyId, parsed.data.definition),
    );
    revalidatePath("/estrategias");
    revalidatePath(`/estrategias/${updated.id}`);
    return { status: "ok", strategyId: updated.id };
  } catch (error) {
    if (error instanceof StrategyNotFoundError) {
      return { status: "error", error: "not_found" };
    }
    throw error;
  }
}

export async function setStrategyVisibilityAction(input: {
  strategyId: string;
  visibility: "private" | "shared";
}): Promise<StrategyActionResult> {
  const parsed = shareInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  try {
    await withRepository((repository) =>
      repository.setVisibility(parsed.data.strategyId, parsed.data.visibility),
    );
    revalidatePath("/estrategias");
    revalidatePath(`/estrategias/${parsed.data.strategyId}`);
    return { status: "ok", strategyId: parsed.data.strategyId };
  } catch (error) {
    if (error instanceof StrategyNotFoundError) {
      return { status: "error", error: "not_found" };
    }
    throw error;
  }
}

export async function copySharedStrategyAction(input: {
  sourceStrategyId: string;
}): Promise<StrategyActionResult> {
  const parsed = copyInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  try {
    const copy = await withRepository((repository) =>
      repository.copyShared(parsed.data.sourceStrategyId),
    );
    revalidatePath("/estrategias");
    return { status: "ok", strategyId: copy.id };
  } catch (error) {
    if (error instanceof StrategyNotFoundError) {
      return { status: "error", error: "not_found" };
    }
    if (error instanceof StrategyNotSharedError) {
      return { status: "error", error: "not_shared" };
    }
    throw error;
  }
}
