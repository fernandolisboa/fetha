import { z } from "zod";

export const themes = [
  "instrumento",
  "terminal",
  "amplo",
  "grafite",
  "ouro-negro",
  "fosforo",
  "papel",
] as const;

export const themeSchema = z.enum(themes).default("instrumento");

export type Theme = z.infer<typeof themeSchema>;

export type ThemeMode = "dark" | "light";

const themeModes: Record<Theme, ThemeMode> = {
  instrumento: "dark",
  terminal: "dark",
  amplo: "dark",
  grafite: "dark",
  "ouro-negro": "dark",
  fosforo: "dark",
  papel: "light",
};

export function themeMode(theme: Theme): ThemeMode {
  return themeModes[theme];
}
