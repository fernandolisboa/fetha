import { z } from "zod";
import { strategyDefinitionInputSchema } from "./strategy-definition";

export const expectedMoves = ["up", "down", "sideways", "big_move"] as const;
export const expectedMoveSchema = z.enum(expectedMoves);
export type ExpectedMove = z.infer<typeof expectedMoveSchema>;

export const ivRegimes = ["low", "high", "any"] as const;
export const ivRegimeSchema = z.enum(ivRegimes);
export type IvRegime = z.infer<typeof ivRegimeSchema>;

// A recipe (docs/adr/0064): a complete strategy definition a user copies by
// stating the move they expect. Sizing is always fixed_risk so the user's
// answer to "how much do you accept to lose" replaces its fraction and
// nothing else.
export const recipeSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  expectedMove: expectedMoveSchema,
  ivRegime: ivRegimeSchema,
  definition: strategyDefinitionInputSchema.refine(
    (definition) => definition.sizing.kind === "fixed_risk",
    { message: "a recipe sizes by fixed_risk", path: ["sizing"] },
  ),
  reference: z.string().min(1),
  notes: z.string().min(1),
});
export type Recipe = z.infer<typeof recipeSchema>;

export const recipeBookSchema = z
  .array(recipeSchema)
  .min(1)
  .refine((recipes) => new Set(recipes.map((recipe) => recipe.id)).size === recipes.length, {
    message: "recipe ids must be unique",
  });
