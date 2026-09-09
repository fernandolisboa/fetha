import { z } from "zod";

export const timeframes = ["15m", "30m", "60m", "D1"] as const;
export const timeframeSchema = z.enum(timeframes);
export type Timeframe = z.infer<typeof timeframeSchema>;
