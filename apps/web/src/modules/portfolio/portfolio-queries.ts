import { cache } from "react";

import { getDb } from "@/db/client";
import { nowInstant } from "@/lib/instant";
import { recordAccess } from "@/modules/audit";
import { requireUser } from "@/modules/auth";

import { loadPortfolio, type PortfolioReadModel } from "./portfolio-service";

export const getMyPortfolio = cache(async (): Promise<PortfolioReadModel> => {
  const user = await requireUser();
  await recordAccess("portfolio_read");
  return loadPortfolio(getDb(), user, nowInstant());
});
