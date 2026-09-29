"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  checkStrategyCoherence,
  strategyDefinitionInputSchema,
  type StrategyDefinition,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  forCurrentUser,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";

import { classifyPersistenceError } from "./pg-error";
import { SignalsRepository } from "./signals-repository";
import {
  StrategiesRepository,
  StrategyArchivedError,
  StrategyLimitReachedError,
  StrategyNotFoundError,
  StrategyNotSharedError,
  StrategyVersionLimitError,
  type StrategySearchResult,
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
        | "archived"
        | "rate_limited"
        | "limit_reached";
    };

const createInputSchema = z.strictObject({ definition: strategyDefinitionInputSchema });

const addVersionInputSchema = z.strictObject({
  strategyId: z.string().min(1).max(200),
  definition: strategyDefinitionInputSchema,
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

const searchInputSchema = z.strictObject({ query: z.string().trim().min(1).max(100) });

const SEARCH_RATE_LIMIT = { windowSeconds: 10, max: 30 };
const MAX_SEARCH_RESULTS = 8;

function mapKnownError(
  error: unknown,
):
  | "not_found"
  | "not_shared"
  | "conflict"
  | "unavailable"
  | "version_limit"
  | "archived"
  | "rate_limited"
  | "limit_reached"
  | null {
  if (error instanceof AccountRateLimitExceededError) return "rate_limited";
  if (error instanceof StrategyNotFoundError) return "not_found";
  if (error instanceof StrategyVersionLimitError) return "version_limit";
  if (error instanceof StrategyNotSharedError) return "not_shared";
  if (error instanceof StrategyArchivedError) return "archived";
  if (error instanceof StrategyLimitReachedError) return "limit_reached";
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

// Archived strategies leave the 200-strategy cap (docs/adr/0043), so the cap
// alone no longer bounds a create → archive → create loop (#217). One bucket
// covers every action that adds a strategy or moves one across the cap.
const WRITE_RATE_LIMIT = { windowSeconds: 60, max: 20 };

async function withRateLimitedRepository<T>(
  run: (repository: StrategiesRepository) => Promise<T>,
): Promise<T> {
  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    await enforceAccountRateLimit(getDb(), user.email, "strategies/write", WRITE_RATE_LIMIT);
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
    const created = await withRateLimitedRepository(async (repository) => {
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
    const copy = await withRateLimitedRepository((repository) =>
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
  | { status: "ok" }
  | { status: "error"; error: "invalid" | "not_found" | "rate_limited" | "unavailable" };

export async function archiveStrategyAction(input: {
  strategyId: string;
}): Promise<ArchiveStrategyResult> {
  const parsed = archiveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  try {
    await withRateLimitedRepository((repository) => repository.archive(parsed.data.strategyId));
    revalidatePath("/estrategias");
    revalidatePath(`/estrategias/${parsed.data.strategyId}`);
    return { status: "ok" };
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return { status: "error", error: "rate_limited" };
    }
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
  | {
      status: "error";
      error: "invalid" | "not_found" | "limit_reached" | "rate_limited" | "unavailable";
    };

export async function unarchiveStrategyAction(input: {
  strategyId: string;
}): Promise<UnarchiveStrategyResult> {
  const parsed = archiveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  try {
    await withRateLimitedRepository((repository) => repository.unarchive(parsed.data.strategyId));
    revalidatePath("/estrategias");
    revalidatePath(`/estrategias/${parsed.data.strategyId}`);
    return { status: "ok" };
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return { status: "error", error: "rate_limited" };
    }
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

export type SearchMyStrategiesResult =
  { status: "ok"; results: StrategySearchResult[] } | { status: "error"; error: "rate_limited" };

export async function searchMyStrategiesAction(input: {
  query: string;
}): Promise<SearchMyStrategiesResult> {
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "ok", results: [] };
  }
  const user = await withAuthenticatedAction(() => requireUser());
  try {
    await enforceAccountRateLimit(getDb(), user.email, "strategies/search", SEARCH_RATE_LIMIT);
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return { status: "error", error: "rate_limited" };
    }
    throw error;
  }
  const repository = await forCurrentUser(getDb(), StrategiesRepository);
  const results = await repository.searchMine(parsed.data.query, MAX_SEARCH_RESULTS);
  return { status: "ok", results };
}
