import { z } from "zod";

export const accessEventSchema = z.enum(["portfolio_read", "decisions_read", "data_export"]);

export type AccessEvent = z.infer<typeof accessEventSchema>;
