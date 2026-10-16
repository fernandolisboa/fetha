import { eq, sql } from "drizzle-orm";
import { aiSettingsModelFamiliesSchema, type AiSettingsModelFamilies } from "@fetha/contracts";

import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { aiSettings } from "./schema";
import { decryptApiKey, encryptApiKey } from "./crypto";

export interface ApiKeyStatus {
  configured: boolean;
  last4: string | null;
  updatedAt: Date | null;
  // false only when a row exists with a ciphertext that no longer decrypts
  // (a rotated `BETTER_AUTH_SECRET`, a tampered row): the UI then shows "your
  // key could not be read" instead of silently falling back to the server
  // key (docs/adr/0068).
  readable: boolean;
}

export type OwnApiKey =
  { status: "none" } | { status: "unreadable" } | { status: "ok"; key: string };

function parseFamilies(value: unknown): AiSettingsModelFamilies {
  const parsed = aiSettingsModelFamiliesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export class AiSettingsRepository extends UserScopedRepository {
  async getModelFamilies(): Promise<AiSettingsModelFamilies> {
    const [row] = await this.db
      .select({ modelFamilies: aiSettings.modelFamilies })
      .from(aiSettings)
      .where(eq(aiSettings.userId, this.userId))
      .limit(1);
    return row ? parseFamilies(row.modelFamilies) : {};
  }

  // One statement, merging the one changed kind into whatever
  // `model_families` currently holds in Postgres itself (`||` to set it,
  // `-` to drop it back to "default"): each row on the panel fires its own
  // save independently, so a read-modify-write here would lose a
  // concurrent sibling's change (docs/adr/0068, #322 review).
  async setModelFamily(
    kind: keyof AiSettingsModelFamilies,
    family: AiSettingsModelFamilies[keyof AiSettingsModelFamilies] | undefined,
  ): Promise<void> {
    const seed = aiSettingsModelFamiliesSchema.parse(
      family === undefined ? {} : { [kind]: family },
    );
    const merge =
      family === undefined
        ? sql`${aiSettings.modelFamilies} - ${kind}`
        : sql`${aiSettings.modelFamilies} || ${JSON.stringify(seed)}::jsonb`;
    await this.db
      .insert(aiSettings)
      .values({ userId: this.userId, modelFamilies: seed })
      .onConflictDoUpdate({
        target: aiSettings.userId,
        set: { modelFamilies: merge, updatedAt: new Date() },
      });
  }

  async getApiKeyStatus(secret: string): Promise<ApiKeyStatus> {
    const [row] = await this.db
      .select({
        apiKeyCiphertext: aiSettings.apiKeyCiphertext,
        apiKeyLast4: aiSettings.apiKeyLast4,
        apiKeyUpdatedAt: aiSettings.apiKeyUpdatedAt,
      })
      .from(aiSettings)
      .where(eq(aiSettings.userId, this.userId))
      .limit(1);
    if (!row || row.apiKeyCiphertext === null) {
      return { configured: false, last4: null, updatedAt: null, readable: true };
    }
    const decrypted = decryptApiKey(row.apiKeyCiphertext, secret, this.userId);
    return {
      configured: true,
      last4: row.apiKeyLast4,
      updatedAt: row.apiKeyUpdatedAt,
      readable: decrypted.ok,
    };
  }

  // Used only by server actions that must hand the plaintext to the
  // Anthropic SDK; never by a query a page or the data export reads from.
  async readOwnApiKey(secret: string): Promise<OwnApiKey> {
    const [row] = await this.db
      .select({ apiKeyCiphertext: aiSettings.apiKeyCiphertext })
      .from(aiSettings)
      .where(eq(aiSettings.userId, this.userId))
      .limit(1);
    if (!row || row.apiKeyCiphertext === null) {
      return { status: "none" };
    }
    const decrypted = decryptApiKey(row.apiKeyCiphertext, secret, this.userId);
    return decrypted.ok ? { status: "ok", key: decrypted.plaintext } : { status: "unreadable" };
  }

  async saveApiKey(apiKey: string, secret: string): Promise<void> {
    const ciphertext = encryptApiKey(apiKey, secret, this.userId);
    const last4 = apiKey.slice(-4);
    await this.db
      .insert(aiSettings)
      .values({
        userId: this.userId,
        apiKeyCiphertext: ciphertext,
        apiKeyLast4: last4,
        apiKeyUpdatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: aiSettings.userId,
        set: {
          apiKeyCiphertext: ciphertext,
          apiKeyLast4: last4,
          apiKeyUpdatedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }

  async removeApiKey(): Promise<void> {
    await this.db
      .insert(aiSettings)
      .values({
        userId: this.userId,
        apiKeyCiphertext: null,
        apiKeyLast4: null,
        apiKeyUpdatedAt: null,
      })
      .onConflictDoUpdate({
        target: aiSettings.userId,
        set: {
          apiKeyCiphertext: null,
          apiKeyLast4: null,
          apiKeyUpdatedAt: null,
          updatedAt: new Date(),
        },
      });
  }
}
