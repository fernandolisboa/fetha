import { and, eq, isNotNull } from "drizzle-orm";

import type { Database } from "@/db/client";

import { account } from "./schema";
import type { CurrentUser } from "./session";

export async function hasPassword(db: Database, currentUser: CurrentUser): Promise<boolean> {
  const [row] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        eq(account.userId, currentUser.id),
        eq(account.providerId, "credential"),
        isNotNull(account.password),
      ),
    )
    .limit(1);
  return row !== undefined;
}
