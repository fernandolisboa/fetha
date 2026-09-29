// Run after every migration, in CI (ci.yml, migrate-production.yml) or by
// hand against fetha-preview (apps/web/.env.local) or, with
// ALLOW_PRODUCTION_DATABASE=1, production (lib/database-guard.mjs):
//   node scripts/seed-structures.mjs
// Seeds the reference structure catalog (docs/adr/0012, docs/adr/0053,
// CLAUDE.md principle 5: shared, read-only data no user writes) from
// src/modules/strategies/catalog.json, the one source the app's editor
// defaults read too. An upsert: re-running it after a catalog edit brings
// each row's name/legs up to date. An entry removed from the file is not
// deleted: strategy versions keep referencing it.
//
// Each structure is validated against a plain re-statement of
// `packages/contracts/src/structure.ts`'s shape before it is written, since
// this script runs as plain Node with no TypeScript build step (same
// constraint as scripts/seed-invite.mjs) and cannot import that module's
// `.ts` source directly. The whole entry is checked against the contracts
// schemas by src/modules/strategies/catalog.test.ts.
import { neon } from "@neondatabase/serverless";
import { z } from "zod";

import catalog from "../src/modules/strategies/catalog.json" with { type: "json" };

import { assertWritableDatabase, guardedDatabaseEnv } from "./lib/database-guard.mjs";
import { routeToLocalNeonProxy } from "./lib/local-neon.mjs";

const legTemplateSchema = z.discriminatedUnion("role", [
  z.strictObject({
    role: z.literal("stock"),
    side: z.enum(["buy", "sell"]),
    ratio: z.int().min(1),
  }),
  z.strictObject({
    role: z.enum(["call", "put"]),
    side: z.enum(["buy", "sell"]),
    ratio: z.int().min(1),
    strikeRank: z.int().min(1),
  }),
]);

const structureSchema = z
  .strictObject({
    id: z.string().min(1),
    name: z.string().min(1),
    legs: z.array(legTemplateSchema).min(1),
  })
  .refine(
    ({ legs }) => {
      const ranks = new Set(legs.flatMap((leg) => (leg.role === "stock" ? [] : [leg.strikeRank])));
      return [...ranks].every((rank) => rank <= ranks.size);
    },
    { message: "strike ranks must be 1..k without gaps", path: ["legs"] },
  );

const catalogSchema = z
  .array(structureSchema)
  .min(1)
  .refine((structures) => new Set(structures.map(({ id }) => id)).size === structures.length, {
    message: "structure ids must be unique",
  });

const env = guardedDatabaseEnv(assertWritableDatabase, "seed the structure catalog");
routeToLocalNeonProxy(env.DATABASE_URL);
const sql = neon(env.DATABASE_URL);

const structures = catalogSchema.parse(
  catalog.map(({ structure: { id, name, legs } }) => ({ id, name, legs })),
);

for (const structure of structures) {
  await sql`
    insert into structures (id, name, legs)
    values (${structure.id}, ${structure.name}, ${JSON.stringify(structure.legs)})
    on conflict (id) do update set name = excluded.name, legs = excluded.legs
  `;
  console.log(`Seeded structure "${structure.id}".`);
}
