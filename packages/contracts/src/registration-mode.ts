import { z } from "zod";

export const registrationModeSchema = z.enum(["open", "invite", "closed"]).default("invite");

export type RegistrationMode = z.infer<typeof registrationModeSchema>;
