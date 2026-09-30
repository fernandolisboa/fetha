import { z } from "zod";

export const accessEventSchema = z.enum([
  "portfolio_read",
  "decisions_read",
  "data_export",
  "nightly_triggered",
  "corporate_action_recorded",
]);

export type AccessEvent = z.infer<typeof accessEventSchema>;
