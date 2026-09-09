import { z } from "zod";

export const holidayRowSchema = z.object({
  date: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
});
export type HolidayRow = z.infer<typeof holidayRowSchema>;

export const tradingSessionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  open: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
  close: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
});
export type ParsedTradingSession = z.infer<typeof tradingSessionSchema>;
