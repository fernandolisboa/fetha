import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { replayInstrumentsRegistry } from "./replay";

const sample = path.join(import.meta.dirname, "fixtures", "instruments-sample.csv");
const e2eRecordings = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "e2e",
  "fixtures",
  "b3-instruments",
);
const header =
  "Status do Arquivo: Final\nRptDt;TckrSymb;Asst;SctyCtgyNm;XprtnDt;ISIN;OptnTp;ExrcPric;OptnStyle\n";

describe("replayInstrumentsRegistry", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "recorded-instruments-"));
    await copyFile(sample, path.join(directory, "2026-09-08.csv"));
    await writeFile(path.join(directory, "2026-09-18.csv"), header, { encoding: "latin1" });
    await writeFile(path.join(directory, "notes.txt"), "not a recording");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("replays the session's own recording", async () => {
    const registry = await replayInstrumentsRegistry(directory, "2026-09-08");
    expect(registry.series).toHaveLength(13);
  });

  it("replays the newest recording before a session that has none", async () => {
    expect((await replayInstrumentsRegistry(directory, "2026-09-17")).series).toHaveLength(13);
    expect((await replayInstrumentsRegistry(directory, "2026-10-14")).series).toHaveLength(0);
  });

  it("fails for a session older than every recording", async () => {
    await expect(replayInstrumentsRegistry(directory, "2026-09-04")).rejects.toThrow(
      "no instruments registry recorded on or before 2026-09-04",
    );
  });
});

describe("the e2e recordings", () => {
  it.each(["2026-09-08", "2026-09-09", "2026-09-18"])(
    "%s parses whole, PETR4 series only, with the monthly expiry the portfolio spec settles",
    async (session) => {
      const { series, skipped } = await replayInstrumentsRegistry(e2eRecordings, session);
      expect(skipped).toBe(0);
      expect(series.length).toBeGreaterThan(3000);
      expect(new Set(series.map((row) => row.underlying))).toEqual(new Set(["PETR4"]));
      expect(new Set(series.map((row) => row.asOf))).toEqual(new Set([session]));
      expect(series.some((row) => row.expiry === "2026-09-18")).toBe(true);
    },
  );
});
