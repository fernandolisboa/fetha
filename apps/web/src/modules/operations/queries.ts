import { cache } from "react";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";
import { optionChainForUnderlying, type ChainSeries } from "@/modules/market-data";

import { OperationsRepository, type ContemplatedOperation } from "./operations-repository";

export const getMyOperations = cache(async (): Promise<ContemplatedOperation[]> => {
  const repository = await forCurrentUser(getDb(), OperationsRepository);
  return repository.listMine();
});

export const getOptionChain = cache(async (underlying: string): Promise<ChainSeries[]> =>
  optionChainForUnderlying(getDb(), underlying),
);
