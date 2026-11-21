import { describe, expect, it } from "vitest";
import type { Centavos } from "@fetha/contracts";

import { aggregateRollChainByMonth, chainIdsFrom, rollChainToCsv } from "./roll-chain";

describe("chainIdsFrom", () => {
  it("walks the whole chain from any link, oldest first", () => {
    const operations = [
      { id: "op-1", rolledFromOperationId: null },
      { id: "op-2", rolledFromOperationId: "op-1" },
      { id: "op-3", rolledFromOperationId: "op-2" },
    ];
    expect(chainIdsFrom(operations, "op-2")).toEqual(["op-1", "op-2", "op-3"]);
    expect(chainIdsFrom(operations, "op-1")).toEqual(["op-1", "op-2", "op-3"]);
    expect(chainIdsFrom(operations, "op-3")).toEqual(["op-1", "op-2", "op-3"]);
  });

  it("is a chain of one for an operation that never rolled", () => {
    const operations = [
      { id: "op-1", rolledFromOperationId: null },
      { id: "op-9", rolledFromOperationId: null },
    ];
    expect(chainIdsFrom(operations, "op-1")).toEqual(["op-1"]);
  });

  it("never loops on a cycle a corrupt row might introduce", () => {
    const operations = [
      { id: "op-1", rolledFromOperationId: "op-2" },
      { id: "op-2", rolledFromOperationId: "op-1" },
    ];
    expect(chainIdsFrom(operations, "op-1").length).toBeLessThanOrEqual(2);
  });
});

describe("aggregateRollChainByMonth", () => {
  it("carries a running total forward across months in chronological order", () => {
    const rows = aggregateRollChainByMonth([
      { operationId: "op-2", month: "2027-02", netCentavos: -200 as Centavos, open: false },
      { operationId: "op-1", month: "2027-01", netCentavos: 500 as Centavos, open: false },
    ]);

    expect(rows).toEqual([
      {
        month: "2027-01",
        operationIds: ["op-1"],
        netCentavos: 500,
        runningTotalCentavos: 500,
        openOperationId: null,
      },
      {
        month: "2027-02",
        operationIds: ["op-2"],
        netCentavos: -200,
        runningTotalCentavos: 300,
        openOperationId: null,
      },
    ]);
  });

  it("sums more than one roll that landed in the same month", () => {
    const rows = aggregateRollChainByMonth([
      { operationId: "op-1", month: "2027-01", netCentavos: 100 as Centavos, open: false },
      { operationId: "op-2", month: "2027-01", netCentavos: 50 as Centavos, open: false },
    ]);

    expect(rows).toEqual([
      {
        month: "2027-01",
        operationIds: ["op-1", "op-2"],
        netCentavos: 150,
        runningTotalCentavos: 150,
        openOperationId: null,
      },
    ]);
  });

  it("names the still-open link's own id on its own row", () => {
    const rows = aggregateRollChainByMonth([
      { operationId: "op-1", month: "2027-01", netCentavos: 100 as Centavos, open: false },
      { operationId: "op-2", month: "2027-02", netCentavos: 50 as Centavos, open: true },
    ]);

    expect(rows[0]?.openOperationId).toBeNull();
    expect(rows[1]?.openOperationId).toBe("op-2");
  });

  it("is empty for an empty chain", () => {
    expect(aggregateRollChainByMonth([])).toEqual([]);
  });
});

describe("rollChainToCsv", () => {
  it("renders plain decimal numbers and a header, not pt-BR formatting", () => {
    const csv = rollChainToCsv([
      {
        month: "2027-01",
        operationIds: ["op-1"],
        netCentavos: 500 as Centavos,
        runningTotalCentavos: 500 as Centavos,
        openOperationId: null,
      },
      {
        month: "2027-02",
        operationIds: ["op-2"],
        netCentavos: -230 as Centavos,
        runningTotalCentavos: 270 as Centavos,
        openOperationId: "op-2",
      },
    ]);

    expect(csv).toBe(
      "month,operation_ids,net,running_total\n" +
        "2027-01,op-1,5.00,5.00\n" +
        "2027-02,op-2,-2.30,2.70\n",
    );
  });

  it("joins more than one operation id with a semicolon", () => {
    const csv = rollChainToCsv([
      {
        month: "2027-01",
        operationIds: ["op-1", "op-2"],
        netCentavos: 0 as Centavos,
        runningTotalCentavos: 0 as Centavos,
        openOperationId: null,
      },
    ]);

    expect(csv).toContain("op-1;op-2");
  });

  it("is just the header for an empty chain", () => {
    expect(rollChainToCsv([])).toBe("month,operation_ids,net,running_total\n");
  });
});
