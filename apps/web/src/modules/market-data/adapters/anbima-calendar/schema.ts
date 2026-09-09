import { instantSchema, sessionDateSchema } from "@fetha/contracts";
import { z } from "zod";

export const holidaySchema = z.object({
  date: sessionDateSchema,
  name: z.string().min(1),
});
export type Holiday = z.infer<typeof holidaySchema>;

export const holidaysFileSchema = z.array(holidaySchema);

export const tradingSessionSchema = z.object({
  date: sessionDateSchema,
  open: instantSchema,
  close: instantSchema,
});
export type ParsedTradingSession = z.infer<typeof tradingSessionSchema>;
