import { eq } from "drizzle-orm";

import { themeSchema, type Theme } from "@fetha/contracts";
import { preferences } from "@/db/schema/preferences";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

export interface Preferences {
  theme: Theme;
  railCollapsed: boolean;
}

const defaults: Preferences = { theme: themeSchema.parse(undefined), railCollapsed: false };

export class PreferencesRepository extends UserScopedRepository {
  async find(): Promise<Preferences> {
    const [row] = await this.db
      .select({ theme: preferences.theme, railCollapsed: preferences.railCollapsed })
      .from(preferences)
      .where(eq(preferences.userId, this.userId))
      .limit(1);

    if (!row) {
      return defaults;
    }

    return { theme: themeSchema.parse(row.theme), railCollapsed: row.railCollapsed };
  }

  async setTheme(theme: Theme): Promise<void> {
    await this.upsert({ theme });
  }

  async setRailCollapsed(railCollapsed: boolean): Promise<void> {
    await this.upsert({ railCollapsed });
  }

  private async upsert(patch: Partial<Preferences>): Promise<void> {
    const current = await this.find();
    const next = { ...current, ...patch };

    await this.db
      .insert(preferences)
      .values({ userId: this.userId, theme: next.theme, railCollapsed: next.railCollapsed })
      .onConflictDoUpdate({
        target: preferences.userId,
        set: { theme: next.theme, railCollapsed: next.railCollapsed, updatedAt: new Date() },
      });
  }
}
