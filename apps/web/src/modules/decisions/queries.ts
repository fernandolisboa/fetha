import { cache } from "react";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import { DecisionsRepository, type DecisionListItem } from "./decisions-repository";

export const getMyDecisions = cache(async (): Promise<DecisionListItem[]> => {
  const repository = await forCurrentUser(getDb(), DecisionsRepository);
  return repository.listMine();
});

// SignalRow's own "answered" state (brief item 5), batched over the given
// page of signal ids in one query instead of one per row (and independent
// of `listMine`'s `JOURNAL_LIMIT`, round 3): a signal with no decision yet
// is simply absent from the map.
export async function getMyDecisionsBySignalId(
  signalIds: readonly string[],
): Promise<Map<string, DecisionListItem>> {
  const repository = await forCurrentUser(getDb(), DecisionsRepository);
  return repository.findForSignals(signalIds);
}

// The `/carteira` row's own "answered" state, batched the same way over the
// given page of contemplated operation ids.
export async function getMyDecisionsByOperationId(
  operationIds: readonly string[],
): Promise<Map<string, DecisionListItem>> {
  const repository = await forCurrentUser(getDb(), DecisionsRepository);
  return repository.findLatestForOperations(operationIds);
}
