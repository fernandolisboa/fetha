import { eq } from "drizzle-orm";

import { preferences } from "@/db/schema/preferences";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { themeSchema, type Theme } from "./theme";

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

    const parsedTheme = themeSchema.safeParse(row.theme);
    return {
      theme: parsedTheme.success ? parsedTheme.data : defaults.theme,
      railCollapsed: row.railCollapsed,
    };
  }

  async setTheme(theme: Theme): Promise<void> {
    await this.upsert({ theme });
  }

  async setRailCollapsed(railCollapsed: boolean): Promise<void> {
    await this.upsert({ railCollapsed });
  }

  private async upsert(patch: Partial<Preferences>): Promise<void> {
    await this.db
      .insert(preferences)
      .values({ userId: this.userId, ...patch })
      .onConflictDoUpdate({
        target: preferences.userId,
        set: { ...patch, updatedAt: new Date() },
      });
  }
}
