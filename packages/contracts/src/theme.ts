import { z } from "zod";

export const themes = ["instrumento", "terminal", "amplo"] as const;

export const themeSchema = z.enum(themes).default("instrumento");

export type Theme = z.infer<typeof themeSchema>;
