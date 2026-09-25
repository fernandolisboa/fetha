import { cache } from "react";

import { getDb } from "@/db/client";
import { nowInstant } from "@/lib/instant";
import { requireUser } from "@/modules/auth";

import { PortfolioRepository } from "./portfolio-repository";
import { loadPortfolio, type PortfolioReadModel } from "./portfolio-service";

export const getMyPortfolio = cache(async (): Promise<PortfolioReadModel> => {
  const user = await requireUser();
  return loadPortfolio(getDb(), user, nowInstant());
});

export const getMyOpenOperationCount = cache(async (): Promise<number> => {
  const user = await requireUser();
  return new PortfolioRepository(getDb(), user).countOpenOperations();
});
