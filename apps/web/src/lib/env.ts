import { registrationModeSchema, type RegistrationMode } from "@fetha/contracts";

export function registrationMode(): RegistrationMode {
  return registrationModeSchema.parse(process.env.REGISTRATION_MODE);
}
