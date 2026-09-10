import { desc, eq } from "drizzle-orm";
import { riskProfileSchema, type RiskProfile } from "@fetha/contracts";

import { riskProfiles } from "@/db/schema/risk-profiles";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

// Append-only (UBIQUITOUS_LANGUAGE.md "Risk profile"): every declaration is
// a new row, the current profile is the latest by `created_at`, and no
// method here updates or deletes a row.
export class RiskProfileRepository extends UserScopedRepository {
  async current(): Promise<RiskProfile | null> {
    const [row] = await this.db
      .select({ declaredCapital: riskProfiles.declaredCapital, limits: riskProfiles.limits })
      .from(riskProfiles)
      .where(eq(riskProfiles.userId, this.userId))
      .orderBy(desc(riskProfiles.createdAt))
      .limit(1);

    if (!row) {
      return null;
    }

    return riskProfileSchema.parse({
      declaredCapital: row.declaredCapital,
      limits: row.limits,
    });
  }

  async history(): Promise<Array<{ profile: RiskProfile; declaredAt: Date }>> {
    const rows = await this.db
      .select({
        declaredCapital: riskProfiles.declaredCapital,
        limits: riskProfiles.limits,
        createdAt: riskProfiles.createdAt,
      })
      .from(riskProfiles)
      .where(eq(riskProfiles.userId, this.userId))
      .orderBy(desc(riskProfiles.createdAt));

    return rows.map((row) => ({
      profile: riskProfileSchema.parse({
        declaredCapital: row.declaredCapital,
        limits: row.limits,
      }),
      declaredAt: row.createdAt,
    }));
  }

  async declare(profile: RiskProfile): Promise<void> {
    await this.db.insert(riskProfiles).values({
      userId: this.userId,
      declaredCapital: profile.declaredCapital,
      limits: profile.limits,
    });
  }
}
