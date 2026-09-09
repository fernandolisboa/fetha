import { z } from "zod";

export const legRoles = ["stock", "call", "put"] as const;
export const legSides = ["buy", "sell"] as const;

const ratioSchema = z.int().min(1);

export const legTemplateSchema = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("stock"), side: z.enum(legSides), ratio: ratioSchema }),
  z.strictObject({
    role: z.enum(["call", "put"]),
    side: z.enum(legSides),
    ratio: ratioSchema,
    strikeRank: z.int().min(1),
  }),
]);
export type LegTemplate = z.infer<typeof legTemplateSchema>;

export const structureSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  expiry: z.literal("shared"),
  legs: z.array(legTemplateSchema).min(1),
});
export type Structure = z.infer<typeof structureSchema>;
