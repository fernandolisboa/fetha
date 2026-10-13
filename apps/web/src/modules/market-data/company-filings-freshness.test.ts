import { describe, expect, it } from "vitest";

import { companyFilingsFreshness } from "./company-filings-freshness";

// 22:00 in São Paulo on 2026-10-13, already the 14th in UTC.
const NOW = new Date("2026-10-14T01:00:00.000Z");

describe("companyFilingsFreshness", () => {
  it("says nothing while no filing is stored", () => {
    expect(companyFilingsFreshness(undefined, NOW)).toBeNull();
  });

  it("phrases today and yesterday in São Paulo like the market bar", () => {
    expect(companyFilingsFreshness("2026-10-13", NOW)).toBe("Dados da CVM até hoje.");
    expect(companyFilingsFreshness("2026-10-12", NOW)).toBe("Dados da CVM até ontem.");
  });

  it("gives an older cutoff as a Brazilian date", () => {
    expect(companyFilingsFreshness("2026-10-08", NOW)).toBe("Dados da CVM até 08/10/2026.");
  });
});
