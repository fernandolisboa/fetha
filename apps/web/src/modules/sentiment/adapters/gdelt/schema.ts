import { z } from "zod";

// The DOC 2.0 API's timeline JSON: one series per mode, one point per day
// over a three-month span. `norm` (all articles GDELT monitored that day)
// only comes with `timelinevolraw`.
const pointSchema = z.object({
  date: z.string().regex(/^\d{8}T\d{6}Z$/),
  value: z.number(),
  norm: z.number().optional(),
});

export const gdeltTimelineSchema = z.object({
  timeline: z.array(z.object({ series: z.string(), data: z.array(pointSchema).max(400) })).max(4),
});
export type GdeltTimeline = z.infer<typeof gdeltTimelineSchema>;

export const gdeltModes = ["timelinetone", "timelinevolraw"] as const;
export type GdeltMode = (typeof gdeltModes)[number];
