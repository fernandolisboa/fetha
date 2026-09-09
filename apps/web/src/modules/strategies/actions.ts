"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  checkStrategyCoherence,
  strategyDefinitionSchema,
  type StrategyDefinition,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { forCurrentUser, UnauthenticatedError } from "@/modules/auth";

import {
  StrategiesRepository,
  StrategyNotFoundError,
  StrategyNotSharedError,
} from "./strategies-repository";
import { StructuresRepository } from "./structures-repository";

export type StrategyActionResult =
  | { status: "ok"; strategyId: string }
  | {
      status: "error";
      error: "invalid" | "not_found" | "not_shared" | "conflict" | "unavailable";
    };

// A generous ceiling, not a plan limit (CLAUDE.md: no fees, no plans): it
// exists only to bound an unbounded write loop (a bug or a scripted abuser),
// not to constrain the owner's real usage.
const MAX_STRATEGIES_PER_USER = 200;

const createInputSchema = z.strictObject({ definition: strategyDefinitionSchema });

const addVersionInputSchema = z.strictObject({
  strategyId: z.string().min(1).max(200),
  definition: strategyDefinitionSchema,
});

const shareInputSchema = z.strictObject({
  strategyId: z.string().min(1).max(200),
  visibility: z.enum(["private", "shared"]),
});

const copyInputSchema = z.strictObject({ sourceStrategyId: z.string().min(1).max(200) });

function isPgError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
  );
}

function mapKnownError(
  error: unknown,
): "not_found" | "not_shared" | "conflict" | "unavailable" | null {
  if (error instanceof StrategyNotFoundError) return "not_found";
  if (error instanceof StrategyNotSharedError) return "not_shared";
  if (isPgError(error)) {
    if (error.code === "23505" || error.code === "40001" || error.code === "40P01") {
      return "conflict";
    }
    return "unavailable";
  }
  return null;
}

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

async function definitionIsCoherent(definition: StrategyDefinition): Promise<boolean> {
  const structures = await new StructuresRepository(getDb()).listAll();
  const structure = structures.find((candidate) => candidate.id === definition.structureId);
  if (!structure) {
    return false;
  }
  return checkStrategyCoherence(definition, structure).ok;
}

export async function createStrategyAction(input: {
  definition: StrategyDefinition;
}): Promise<StrategyActionResult> {
  const parsed = createInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }
  if (!(await definitionIsCoherent(parsed.data.definition))) {
    return { status: "error", error: "invalid" };
  }

  try {
    const created = await withRepository(async (repository) => {
      const mine = await repository.listMine();
      if (mine.length >= MAX_STRATEGIES_PER_USER) {
        throw new StrategyLimitReachedError();
      }
      return repository.createWithVersion(parsed.data.definition);
    });
    revalidatePath("/estrategias");
    return { status: "ok", strategyId: created.id };
  } catch (error) {
    if (error instanceof StrategyLimitReachedError) {
      return { status: "error", error: "unavailable" };
    }
    const mapped = mapKnownError(error);
    if (mapped) {
      return { status: "error", error: mapped };
    }
    throw error;
  }
}

export async function addStrategyVersionAction(input: {
  strategyId: string;
  definition: StrategyDefinition;
}): Promise<StrategyActionResult> {
  const parsed = addVersionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }
  if (!(await definitionIsCoherent(parsed.data.definition))) {
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
    const mapped = mapKnownError(error);
    if (mapped) {
      return { status: "error", error: mapped };
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
    const mapped = mapKnownError(error);
    if (mapped) {
      return { status: "error", error: mapped };
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
    const mapped = mapKnownError(error);
    if (mapped) {
      return { status: "error", error: mapped };
    }
    throw error;
  }
}

class StrategyLimitReachedError extends Error {
  constructor() {
    super("Strategy limit reached");
    this.name = "StrategyLimitReachedError";
  }
}
