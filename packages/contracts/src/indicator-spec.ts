import { z } from "zod";

export const indicatorKinds = ["sma", "ema", "rsi", "atr", "iv_rank"] as const;

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
