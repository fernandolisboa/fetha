import { z } from "zod";

// Shared by every portfolio Server Action that takes an id over the wire (operations, fills,
// decisions): a database id's own shape, not a domain schema, so it stays here rather than in
// `@fetha/contracts`.
export const idSchema = z.string().min(1).max(64);
