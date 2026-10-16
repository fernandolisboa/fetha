import { eq } from "drizzle-orm";

import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { aiSettings } from "./schema";

// Never the ciphertext (docs/adr/0068): the export carries the same shape
// a page gets, `{ configured, last4 }`, plus the model family choices.
export class AiSettingsDataExport extends UserScopedRepository {
  async tables(): Promise<DataExportTables> {
    const [row] = await this.db
      .select({
        modelFamilies: aiSettings.modelFamilies,
        apiKeyCiphertext: aiSettings.apiKeyCiphertext,
        apiKeyLast4: aiSettings.apiKeyLast4,
        apiKeyUpdatedAt: aiSettings.apiKeyUpdatedAt,
      })
      .from(aiSettings)
      .where(eq(aiSettings.userId, this.userId))
      .limit(1);
    if (!row) {
      return { ai_settings: [] };
    }
    return {
      ai_settings: [
        {
          modelFamilies: row.modelFamilies,
          apiKey: {
            configured: row.apiKeyCiphertext !== null,
            last4: row.apiKeyLast4,
            updatedAt: row.apiKeyUpdatedAt,
          },
        },
      ],
    };
  }
}
