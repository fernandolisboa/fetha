import { eq, inArray, sql } from "drizzle-orm";
import type { FilingTone, FilingTopic } from "@fetha/contracts";

import type { Database } from "@/db/client";
import { filingLabels, type FilingLabelOutcome, type FilingLabelReason } from "../schema";

export interface FilingKey {
  protocol: string;
  version: number;
}

export interface FilingLabelState extends FilingKey {
  outcome: FilingLabelOutcome;
  attempts: number;
  updatedAt: Date;
}

export interface StoredFilingLabel extends FilingKey {
  outcome: FilingLabelOutcome;
  topic: FilingTopic | null;
  tone: FilingTone | null;
  summary: string | null;
}

export type FinalFilingLabel =
  | { outcome: "labelled"; topic: FilingTopic; tone: FilingTone; summary: string }
  | { outcome: "rejected" | "unreadable"; reason: FilingLabelReason };

export interface LabelCall {
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
}

const CHUNK_SIZE = 500;

function keyOf(key: FilingKey): string {
  return `${key.protocol}\u0000${String(key.version)}`;
}

async function rowsFor<T extends FilingKey>(
  keys: readonly FilingKey[],
  read: (protocols: string[]) => Promise<T[]>,
): Promise<T[]> {
  const wanted = new Set(keys.map(keyOf));
  const protocols = [...new Set(keys.map((key) => key.protocol))];
  const rows: T[] = [];
  for (let index = 0; index < protocols.length; index += CHUNK_SIZE) {
    rows.push(...(await read(protocols.slice(index, index + CHUNK_SIZE))));
  }
  return rows.filter((row) => wanted.has(keyOf(row)));
}

export async function filingLabelStates(
  db: Database,
  keys: readonly FilingKey[],
): Promise<FilingLabelState[]> {
  return rowsFor(keys, (protocols) =>
    db
      .select({
        protocol: filingLabels.protocol,
        version: filingLabels.version,
        outcome: filingLabels.outcome,
        attempts: filingLabels.attempts,
        updatedAt: filingLabels.updatedAt,
      })
      .from(filingLabels)
      .where(inArray(filingLabels.protocol, protocols)),
  );
}

export async function storedFilingLabels(
  db: Database,
  keys: readonly FilingKey[],
): Promise<StoredFilingLabel[]> {
  return rowsFor(keys, (protocols) =>
    db
      .select({
        protocol: filingLabels.protocol,
        version: filingLabels.version,
        outcome: filingLabels.outcome,
        topic: filingLabels.topic,
        tone: filingLabels.tone,
        summary: filingLabels.summary,
      })
      .from(filingLabels)
      .where(inArray(filingLabels.protocol, protocols)),
  );
}

// A final outcome is written once: only a `pending` row may still become one.
export async function recordFinalFilingLabel(
  db: Database,
  key: FilingKey,
  label: FinalFilingLabel,
  call: LabelCall | null,
): Promise<void> {
  const values = {
    outcome: label.outcome,
    topic: label.outcome === "labelled" ? label.topic : null,
    tone: label.outcome === "labelled" ? label.tone : null,
    summary: label.outcome === "labelled" ? label.summary : null,
    reason: label.outcome === "labelled" ? null : label.reason,
    model: call?.model ?? null,
    promptVersion: call?.promptVersion ?? null,
    inputTokens: call?.inputTokens ?? null,
    outputTokens: call?.outputTokens ?? null,
  };
  await db
    .insert(filingLabels)
    .values({ ...key, ...values })
    .onConflictDoUpdate({
      target: [filingLabels.protocol, filingLabels.version],
      set: { ...values, updatedAt: sql`now()` },
      setWhere: eq(filingLabels.outcome, "pending"),
    });
}

// Counts one more failed download of a filing still pending; returns the
// attempts now recorded (0 when the row already holds a final outcome).
export async function recordPendingAttempt(db: Database, key: FilingKey): Promise<number> {
  const rows = await db
    .insert(filingLabels)
    .values({ ...key, outcome: "pending", attempts: 1 })
    .onConflictDoUpdate({
      target: [filingLabels.protocol, filingLabels.version],
      set: { attempts: sql`${filingLabels.attempts} + 1`, updatedAt: sql`now()` },
      setWhere: eq(filingLabels.outcome, "pending"),
    })
    .returning({ attempts: filingLabels.attempts });
  return rows[0]?.attempts ?? 0;
}
