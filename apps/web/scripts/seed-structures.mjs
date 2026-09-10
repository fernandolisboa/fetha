// Run after every migration, in CI (ci.yml, migrate-production.yml) or by
// hand with DATABASE_URL pointed at the target database:
//   DATABASE_URL=... node scripts/seed-structures.mjs
// Seeds the reference structure catalog (docs/adr/0012, CLAUDE.md
// principle 5: shared, read-only data no user writes). Alongside the
// trivial stock purchase, #22 adds the two structures its builder ships
// with (collar, trava de alta); #20 extends this further with the
// remaining reference structures (butterfly, condor, ...). An upsert:
// re-running it after a catalog edit in this file brings the row's
// name/legs up to date.
//
// Each row is validated against a plain re-statement of
// `packages/contracts/src/structure.ts`'s shape before it is written, since
// this script runs as plain Node with no TypeScript build step (same
// constraint as scripts/seed-invite.mjs) and cannot import that module's
// `.ts` source directly.
import { neon } from "@neondatabase/serverless";
import { z } from "zod";

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

const structureSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  legs: z.array(legTemplateSchema).min(1),
});

const catalog = [
  { id: "stock", name: "Compra de ação", legs: [{ role: "stock", side: "buy", ratio: 1 }] },
  {
    id: "collar",
    name: "Collar",
    legs: [
      { role: "stock", side: "buy", ratio: 1 },
      { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
      { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
    ],
  },
  {
    id: "bull-call-spread",
    name: "Trava de alta",
    legs: [
      { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
      { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
    ],
  },
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const sql = neon(databaseUrl);

for (const candidate of catalog) {
  const structure = structureSchema.parse(candidate);
  await sql`
    insert into structures (id, name, legs)
    values (${structure.id}, ${structure.name}, ${JSON.stringify(structure.legs)})
    on conflict (id) do update set name = excluded.name, legs = excluded.legs
  `;
  console.log(`Seeded structure "${structure.id}".`);
}
