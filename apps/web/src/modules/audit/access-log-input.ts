import { z } from "zod";
import { instantSchema, sessionDateSchema } from "@fetha/contracts";

import { accessEventSchema } from "./events";

export const ACCESS_LOG_PAGE_SIZE = 200;

const cursorInputSchema = z.strictObject({
  occurredAt: instantSchema,
  id: z.uuid(),
});

export const listAccessLogInputSchema = z
  .strictObject({
    from: sessionDateSchema.optional(),
    to: sessionDateSchema.optional(),
    event: accessEventSchema.optional(),
    ipAddress: z.string().max(64).optional(),
    cursor: cursorInputSchema.optional(),
  })
  .refine((input) => !input.from || !input.to || input.from <= input.to, {
    message: "from must not be after to",
    path: ["to"],
  });

export type ListAccessLogInput = z.input<typeof listAccessLogInputSchema>;
