import { z } from "zod";

// process.env carries unset variables as undefined, but some deployment
// tooling (Vercel dashboard, .env files) leaves them as an empty string
// instead; both must fall back to the default.
export const registrationModeSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.enum(["open", "invite", "closed"]).default("invite"),
);

export type RegistrationMode = z.infer<typeof registrationModeSchema>;
