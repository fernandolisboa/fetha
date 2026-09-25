import { describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { DEFAULT_COST_MODEL } from "@/modules/backtests";

import type { DueDecisionRow } from "./decision-scores-repository";
import { buildScoreInput } from "./score-input";

// A row whose stored `inputs`/`confidence` no longer parse (an older app
// version's shape, corrupted or hand-edited data) must be reported as a
// build failure the caller can mark unscorable once, not thrown out of
// `buildScoreInput` to be retried forever by the generic per-decision catch
// (round 3 item 5, ADR-0014's scoring job section).
function invalidInputsRow(overrides: Partial<DueDecisionRow> = {}): DueDecisionRow {
  return {
    id: "decision-1",
    kind: "hold",
    originKind: "manual",
    inputs: { originKind: "not-a-real-origin-kind" },
    claim: null,
    confidence: "0.6",
    horizon: "2026-09-09",
    costModel: DEFAULT_COST_MODEL,
    decidedAt: new Date("2026-09-08T21:00:00.000Z"),
    strategyVersionId: null,
    ...overrides,
  } as unknown as DueDecisionRow;
}

describe("buildScoreInput — invalid stored inputs (round 3 item 5)", () => {
  const db = {} as Database;

  it("returns invalid_inputs instead of throwing when the stored inputs no longer parse", async () => {
    const result = await buildScoreInput(db, { id: "user-1" }, invalidInputsRow(), []);

    expect(result).toEqual({ ok: false, reason: "invalid_inputs" });
  });

  it("returns invalid_inputs instead of throwing when a signal-shaped inputs object is missing required fields", async () => {
    const row = invalidInputsRow({ inputs: { originKind: "signal" } as never });

    const result = await buildScoreInput(db, { id: "user-1" }, row, []);

    expect(result).toEqual({ ok: false, reason: "invalid_inputs" });
  });
});
