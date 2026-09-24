import { cache } from "react";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import { DecisionsRepository, type DecisionListItem } from "./decisions-repository";

export const getMyDecisions = cache(async (): Promise<DecisionListItem[]> => {
  const repository = await forCurrentUser(getDb(), DecisionsRepository);
  return repository.listMine();
});

// SignalRow's own "answered" state (brief item 5): null when this user has
// not recorded a decision against this signal yet.
export const getMyDecisionForSignal = cache(
  async (signalId: string): Promise<DecisionListItem | null> => {
    const repository = await forCurrentUser(getDb(), DecisionsRepository);
    return repository.findForSignal(signalId);
  },
);

// The `/carteira` row's own "answered" state: the latest decision recorded
// against a contemplated operation, or null.
export const getMyDecisionForOperation = cache(
  async (contemplatedOperationId: string): Promise<DecisionListItem | null> => {
    const repository = await forCurrentUser(getDb(), DecisionsRepository);
    return repository.findLatestForOperation(contemplatedOperationId);
  },
);
