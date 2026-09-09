import { getDb } from "@/db/client";

import { findLatestVerificationLink } from "./verification-link";

export async function readE2EVerificationLink(email: string): Promise<string | undefined> {
  return findLatestVerificationLink(getDb(), email);
}
