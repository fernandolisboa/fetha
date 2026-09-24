import { z } from "zod";

// process.env carries unset variables as undefined, but some deployment
// tooling (Vercel dashboard, .env files) leaves them as an empty string
// instead; both must fall back to the default. The Global Config store
// (docs/adr/0020) is edited by hand in the Vercel dashboard, so its value is
// trimmed and lower-cased the same way: "Open" and " open " both mean "open".
export const registrationModeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() || undefined : value),
  z.enum(["open", "invite", "closed"]).default("invite"),
);

export type RegistrationMode = z.infer<typeof registrationModeSchema>;
