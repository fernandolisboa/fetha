import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  catalogSchema,
  checkStrategyCoherence,
  decimalStringSchema,
  strategyDefinitionInputSchema,
  type CatalogEntry,
  type StrategyDefinition,
} from "@fetha/contracts";

import catalogJson from "./catalog.json";
import { catalog, catalogDefaults } from "./catalog";

function definitionFrom(entry: CatalogEntry): StrategyDefinition {
  return {
    name: entry.structure.name,
    timeframe: "D1",
    entry: {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalStringSchema.parse("0") },
    },
    structureId: entry.structure.id,
    strikes: entry.defaults.strikes,
    ...(entry.defaults.expiry ? { expiry: entry.defaults.expiry } : {}),
    sizing: { kind: "fixed_fractional", fraction: decimalStringSchema.parse("0.1") },
    exit: [],
    adjustments: [],
  };
}

describe("the structure catalog (#20)", () => {
  it("parses through the contracts schema", () => {
    expect(catalogSchema.safeParse(catalogJson).success).toBe(true);
    expect(catalog.length).toBeGreaterThan(3);
  });

  it("keeps the ids strategies and operations already reference", () => {
    expect(catalog.map((entry) => entry.structure.id)).toEqual(
      expect.arrayContaining(["stock", "collar", "bull-call-spread"]),
    );
  });

  it.each(catalog.map((entry) => [entry.structure.id, entry] as const))(
    "%s: its defaults make a writable strategy coherent with its structure",
    (_id, entry) => {
      const definition = definitionFrom(entry);

      expect(strategyDefinitionInputSchema.safeParse(definition).success).toBe(true);
      expect(checkStrategyCoherence(definition, entry.structure)).toEqual({ ok: true });
    },
  );

  // The engine refuses strikes that do not rise with their rank
  // (`degenerate_strikes`), so a default must never ask for that.
  it.each(catalog.map((entry) => [entry.structure.id, entry] as const))(
    "%s: its default strikes rise with their rank",
    (_id, entry) => {
      const percents = entry.defaults.strikes.map((strike) => {
        if (strike.kind !== "moneyness") {
          throw new Error(`expected moneyness defaults, got ${strike.kind}`);
        }
        return Number(strike.percent);
      });

      for (let rank = 1; rank < percents.length; rank += 1) {
        expect(percents[rank]).toBeGreaterThan(percents[rank - 1] ?? Number.POSITIVE_INFINITY);
      }
    },
  );

  it("names a published source for every option structure", () => {
    for (const entry of catalog) {
      if (entry.structure.legs.some((leg) => leg.role !== "stock")) {
        expect(entry.reference).toMatch(/Hull|B3/);
      }
    }
  });

  it("is listed entry by entry in the coverage checklist", () => {
    const checklist = readFileSync(
      path.resolve(import.meta.dirname, "../../../../../docs/catalog.md"),
      "utf8",
    );

    for (const entry of catalog) {
      expect(checklist).toContain(`\`${entry.structure.id}\``);
    }
  });

  it("gives the defaults of a known structure and none of an unknown one", () => {
    expect(catalogDefaults("stock")).toEqual({ strikes: [] });
    expect(catalogDefaults("bull-call-spread")?.strikes).toHaveLength(2);
    expect(catalogDefaults("not-in-the-catalog")).toBeNull();
  });
});
