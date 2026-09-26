import { cache } from "react";

import { getDb } from "@/db/client";
import { recordAccess } from "@/modules/audit";
import { forCurrentUser } from "@/modules/auth";

import { OperationsRepository, type ContemplatedOperation } from "./operations-repository";

export const getMyOperations = cache(async (): Promise<ContemplatedOperation[]> => {
  const repository = await forCurrentUser(getDb(), OperationsRepository);
  await recordAccess("portfolio_read");
  return repository.listMine();
});

export const getMyOperation = cache(async (id: string): Promise<ContemplatedOperation> => {
  const repository = await forCurrentUser(getDb(), OperationsRepository);
  await recordAccess("portfolio_read");
  return repository.findMine(id);
});
