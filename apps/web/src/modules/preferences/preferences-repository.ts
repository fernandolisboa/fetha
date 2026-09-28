import { eq, sql } from "drizzle-orm";

import { preferences } from "./schema";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { themeSchema, type Theme } from "./theme";

export interface Preferences {
  theme: Theme;
  railCollapsed: boolean;
  tourDismissed: boolean;
}

const defaults: Preferences = {
  theme: themeSchema.parse(undefined),
  railCollapsed: false,
  tourDismissed: false,
};

export class PreferencesRepository extends UserScopedRepository {
  async find(): Promise<Preferences> {
    const [row] = await this.db
      .select({
        theme: preferences.theme,
        railCollapsed: preferences.railCollapsed,
        tourDismissedAt: preferences.tourDismissedAt,
      })
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
      tourDismissed: row.tourDismissedAt !== null,
    };
  }

  async setTheme(theme: Theme): Promise<void> {
    await this.upsert({ theme });
  }

  async setRailCollapsed(railCollapsed: boolean): Promise<void> {
    await this.upsert({ railCollapsed });
  }

  // Keeps the first dismissal: replaying the tour and closing it again
  // does not move the timestamp.
  async dismissTour(): Promise<void> {
    await this.db
      .insert(preferences)
      .values({ userId: this.userId, tourDismissedAt: new Date() })
      .onConflictDoUpdate({
        target: preferences.userId,
        set: {
          tourDismissedAt: sql`coalesce(${preferences.tourDismissedAt}, now())`,
          updatedAt: new Date(),
        },
      });
  }

  private async upsert(
    patch: Partial<Pick<Preferences, "theme" | "railCollapsed">>,
  ): Promise<void> {
    await this.db
      .insert(preferences)
      .values({ userId: this.userId, ...patch })
      .onConflictDoUpdate({
        target: preferences.userId,
        set: { ...patch, updatedAt: new Date() },
      });
  }
}
