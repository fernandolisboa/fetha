import { cache } from "react";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import { DecisionsRepository, type DecisionListItem } from "./decisions-repository";

export const getMyDecisions = cache(async (): Promise<DecisionListItem[]> => {
  const repository = await forCurrentUser(getDb(), DecisionsRepository);
  return repository.listMine();
});

// SignalRow's own "answered" state (brief item 5), batched over the whole
// inbox in one query instead of one per row: keyed by signal id, so a
// signal with no decision yet is simply absent from the map.
export const getMyDecisionsBySignalId = cache(async (): Promise<Map<string, DecisionListItem>> => {
  const all = await getMyDecisions();
  return new Map(
    all
      .filter(
        (decision): decision is DecisionListItem & { signalId: string } =>
          decision.signalId !== null,
      )
      .map((decision) => [decision.signalId, decision]),
  );
});

// The `/carteira` row's own "answered" state, batched the same way: keyed by
// contemplated operation id, the *latest* decision per operation (an
// operation carries no uniqueness constraint the way a signal does, brief
// item 2) since `getMyDecisions` is already ordered newest first and the
// first occurrence per id wins.
export const getMyDecisionsByOperationId = cache(
  async (): Promise<Map<string, DecisionListItem>> => {
    const all = await getMyDecisions();
    const map = new Map<string, DecisionListItem>();
    for (const decision of all) {
      if (decision.contemplatedOperationId !== null && !map.has(decision.contemplatedOperationId)) {
        map.set(decision.contemplatedOperationId, decision);
      }
    }
    return map;
  },
);
