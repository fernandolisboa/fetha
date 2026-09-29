import { z } from "zod";

export const indicatorKinds = ["sma", "ema", "rsi", "atr", "iv_rank"] as const;

// docs/adr/0049: a recursive reading walks 6 × length sessions at every
// evaluated candle (ADR-0048), so these bounds cap the cost of one strategy.
// They apply where a definition is written, not where a stored one is read.
export const MAX_INDICATOR_LENGTH = 500;
export const MAX_IV_RANK_LOOKBACK_SESSIONS = 1260;

const lengthIndicatorSchema = z.strictObject({
  kind: z.enum(["sma", "ema", "rsi", "atr"]),
  length: z.int().min(1),
});

const ivRankSchema = z.strictObject({
  kind: z.literal("iv_rank"),
  lookbackSessions: z.int().min(2),
});

export const indicatorSpecSchema = z.union([lengthIndicatorSchema, ivRankSchema]);
export type IndicatorSpec = z.infer<typeof indicatorSpecSchema>;

export function isWithinIndicatorBounds(spec: IndicatorSpec): boolean {
  return spec.kind === "iv_rank"
    ? spec.lookbackSessions <= MAX_IV_RANK_LOOKBACK_SESSIONS
    : spec.length <= MAX_INDICATOR_LENGTH;
}
