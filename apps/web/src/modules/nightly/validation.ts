import { sessionDateSchema } from "@fetha/contracts";
import { z } from "zod";

// A `"use server"` file may only export async functions (Next.js rejects
// anything else at build time), so this Zod schema lives in its own plain
// module instead of alongside `triggerNightlyJobAction`.
export const manualTriggerInputSchema = z
  .object({ session: sessionDateSchema.optional() })
  .strict();
