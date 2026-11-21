import { z } from "zod";

export const suggestionDensities = ["full", "compact"] as const;

export const suggestionDensitySchema = z.enum(suggestionDensities).default("full");

export type SuggestionDensity = z.infer<typeof suggestionDensitySchema>;
