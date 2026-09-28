"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  checkStrategyCoherence,
  strategyDefinitionSchema,
  type StrategyDefinition,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { forCurrentUser, withAuthenticatedAction } from "@/modules/auth";

import { classifyPersistenceError } from "./pg-error";
import { SignalsRepository } from "./signals-repository";
import {
  StrategiesRepository,
  StrategyArchivedError,
  StrategyLimitReachedError,
  StrategyNotFoundError,
  StrategyNotSharedError,
  StrategyVersionLimitError,
} from "./strategies-repository";
import { StructuresRepository } from "./structures-repository";

export type StrategyActionResult =
  | { status: "ok"; strategyId: string }
  | {
      status: "error";
      error:
        | "invalid"
        | "not_found"
        | "not_shared"
        | "conflict"
        | "unavailable"
        | "version_limit"
        | "archived";
    };

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

const activeInputSchema = z.strictObject({
  strategyId: z.string().min(1).max(200),
  active: z.boolean(),
});

const markSignalReadInputSchema = z.strictObject({ signalId: z.string().min(1).max(200) });

function mapKnownError(
  error: unknown,
): "not_found" | "not_shared" | "conflict" | "unavailable" | "version_limit" | "archived" | null {
  if (error instanceof StrategyNotFoundError) return "not_found";
  if (error instanceof StrategyVersionLimitError) return "version_limit";
  if (error instanceof StrategyNotSharedError) return "not_shared";
  if (error instanceof StrategyArchivedError) return "archived";
  if (error instanceof StrategyLimitReachedError) return "unavailable";
  return classifyPersistenceError(error);
}

async function withRepository<T>(
  run: (repository: StrategiesRepository) => Promise<T>,
): Promise<T> {
  return withAuthenticatedAction(async () => {
    const repository = await forCurrentUser(getDb(), StrategiesRepository);
    return run(repository);
  });
}

class IncoherentDefinitionError extends Error {
  constructor() {
    super("Strategy definition is incoherent with its structure");
    this.name = "IncoherentDefinitionError";
  }
}

async function assertDefinitionIsCoherent(definition: StrategyDefinition): Promise<void> {
  const structures = await new StructuresRepository(getDb()).listAll();
  const structure = structures.find((candidate) => candidate.id === definition.structureId);
  if (!structure || !checkStrategyCoherence(definition, structure).ok) {
    throw new IncoherentDefinitionError();
  }
}

export async function createStrategyAction(input: {
  definition: StrategyDefinition;
}): Promise<StrategyActionResult> {
  const parsed = createInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  try {
    const created = await withRepository(async (repository) => {
      await assertDefinitionIsCoherent(parsed.data.definition);
      return repository.createWithVersion(parsed.data.definition);
    });
    revalidatePath("/estrategias");
    return { status: "ok", strategyId: created.id };
  } catch (error) {
    if (error instanceof IncoherentDefinitionError) {
      return { status: "error", error: "invalid" };
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

  try {
    const updated = await withRepository(async (repository) => {
      await assertDefinitionIsCoherent(parsed.data.definition);
      return repository.addVersion(parsed.data.strategyId, parsed.data.definition);
    });
    revalidatePath("/estrategias");
    revalidatePath(`/estrategias/${updated.id}`);
    return { status: "ok", strategyId: updated.id };
  } catch (error) {
    if (error instanceof IncoherentDefinitionError) {
      return { status: "error", error: "invalid" };
    }
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

export async function setStrategyActiveAction(input: {
  strategyId: string;
  active: boolean;
}): Promise<StrategyActionResult> {
  const parsed = activeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  try {
    await withRepository((repository) =>
      repository.setActive(parsed.data.strategyId, parsed.data.active),
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

const archiveInputSchema = z.strictObject({ strategyId: z.string().min(1).max(200) });

export type ArchiveStrategyResult =
  { status: "ok" } | { status: "error"; error: "invalid" | "not_found" | "unavailable" };

export async function archiveStrategyAction(input: {
  strategyId: string;
}): Promise<ArchiveStrategyResult> {
  const parsed = archiveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  try {
    await withRepository((repository) => repository.archive(parsed.data.strategyId));
    revalidatePath("/estrategias");
    revalidatePath(`/estrategias/${parsed.data.strategyId}`);
    return { status: "ok" };
  } catch (error) {
    if (error instanceof StrategyNotFoundError) {
      return { status: "error", error: "not_found" };
    }
    if (classifyPersistenceError(error)) {
      return { status: "error", error: "unavailable" };
    }
    throw error;
  }
}

export type UnarchiveStrategyResult =
  | { status: "ok" }
  | { status: "error"; error: "invalid" | "not_found" | "limit_reached" | "unavailable" };

export async function unarchiveStrategyAction(input: {
  strategyId: string;
}): Promise<UnarchiveStrategyResult> {
  const parsed = archiveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  try {
    await withRepository((repository) => repository.unarchive(parsed.data.strategyId));
    revalidatePath("/estrategias");
    revalidatePath(`/estrategias/${parsed.data.strategyId}`);
    return { status: "ok" };
  } catch (error) {
    if (error instanceof StrategyNotFoundError) {
      return { status: "error", error: "not_found" };
    }
    if (error instanceof StrategyLimitReachedError) {
      return { status: "error", error: "limit_reached" };
    }
    if (classifyPersistenceError(error)) {
      return { status: "error", error: "unavailable" };
    }
    throw error;
  }
}

export type MarkSignalReadResult = { status: "ok" } | { status: "error"; error: "invalid" };

export async function markSignalReadAction(input: {
  signalId: string;
}): Promise<MarkSignalReadResult> {
  const parsed = markSignalReadInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  await withAuthenticatedAction(async () => {
    const repository = await forCurrentUser(getDb(), SignalsRepository);
    await repository.markRead(parsed.data.signalId);
  });
  revalidatePath("/sinais");
  return { status: "ok" };
}
