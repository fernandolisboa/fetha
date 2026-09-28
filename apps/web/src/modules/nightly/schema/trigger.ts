import { z } from "zod";

export const nightlyRunTriggerSchema = z.enum(["cron", "manual"]);

export type NightlyRunTrigger = z.infer<typeof nightlyRunTriggerSchema>;
