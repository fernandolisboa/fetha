import { z } from "zod";

export const layouts = ["workspace", "studio"] as const;

export const layoutSchema = z.enum(layouts).default("workspace");

export type Layout = z.infer<typeof layoutSchema>;
