import { readFileSync } from "node:fs";
import path from "node:path";

import { zipSync } from "fflate";
import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db/client";
import { companyFilings, companyTickers } from "./schema";

import { ingestCvmFilings } from "./cvm-filings-source";
import {
  latestFilingDeliveredOn,
  recentCompanyFilings,
} from "./repositories/company-filing-repository";

const cutShort = vi.hoisted(() => ({ afterRows: undefined as number | undefined }));

// Lands the first rows through the run's own transaction, then fails, the
// way a run killed by the route's maxDuration would.
vi.mock("./repositories/company-filing-repository", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./repositories/company-filing-repository")>();
  return {
    ...original,
    insertCompanyFilings: async (
      ...[db, filings]: Parameters<typeof original.insertCompanyFilings>
    ): Promise<number> => {
      if (cutShort.afterRows === undefined) {
        return original.insertCompanyFilings(db, filings);
      }
      await original.insertCompanyFilings(db, filings.slice(0, cutShort.afterRows));
      throw new Error("cut short");
    },
  };
});

const FIXTURES = path.join(import.meta.dirname, "adapters", "cvm", "fixtures");
const ipeFixture = readFileSync(path.join(FIXTURES, "ipe-sample.csv"), { encoding: "latin1" });
const fcaFixture = readFileSync(path.join(FIXTURES, "fca-valor-mobiliario-sample.csv"), {
  encoding: "latin1",
});

const FIXTURE_CNPJS = [
  "33000167000101",
  "33592510000154",
  "00070698000111",
  "15073274000188",
  "02351144000118",
];
const FIXTURE_TICKERS = ["PETR3", "PETR4", "VALE3", "TGMA3", "ENGI11"];
const OCTOBER_NIGHT = new Date("2026-10-13T23:00:00.000Z");

function latin1(content: string): Uint8Array {
  return Uint8Array.from(content, (character) => character.charCodeAt(0));
}

interface CvmFiles {
  ipe?: Record<number, string>;
  fca?: Record<number, string>;
}

function cvmFetch(files: CvmFiles): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = ((input: string) => {
    urls.push(input);
    const ipe = /ipe_cia_aberta_(\d{4})\.zip$/.exec(input);
    const fca = /fca_cia_aberta_(\d{4})\.zip$/.exec(input);
    const year = Number((ipe ?? fca)?.[1]);
    const content = ipe ? files.ipe?.[year] : fca ? files.fca?.[year] : undefined;
    if (content === undefined) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    const entry = ipe
      ? `ipe_cia_aberta_${String(year)}.csv`
      : `fca_cia_aberta_valor_mobiliario_${String(year)}.csv`;
    return Promise.resolve(new Response(zipSync({ [entry]: latin1(content) }), { status: 200 }));
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

function withVersion(
  content: string,
  protocol: string,
  version: number,
  delivered: string,
): string {
  const [header = "", ...rows] = content.split("\r\n");
  const columns = header.split(";");
  const protocolIndex = columns.indexOf("Protocolo_Entrega");
  const versionIndex = columns.indexOf("Versao");
  const deliveredIndex = columns.indexOf("Data_Entrega");
  const subjectIndex = columns.indexOf("Assunto");
  const row = rows.find((line) => line.split(";")[protocolIndex] === protocol);
  if (!row) {
    throw new Error(`fixture has no ${protocol}`);
  }
  const fields = row.split(";");
  fields[versionIndex] = String(version);
  fields[deliveredIndex] = delivered;
  fields[subjectIndex] = `Reapresentação ${String(version)}`;
  return [header, fields.join(";")].join("\r\n");
}

async function cleanup(): Promise<void> {
  const db = getDb();
  await db.delete(companyFilings).where(inArray(companyFilings.cnpj, FIXTURE_CNPJS));
  await db.delete(companyTickers).where(inArray(companyTickers.ticker, FIXTURE_TICKERS));
}

beforeEach(cleanup);
afterEach(async () => {
  cutShort.afterRows = undefined;
  await cleanup();
});

describe("ingestCvmFilings", () => {
  it("stores the year's filings and the ticker map, then lists a company's newest first", async () => {
    const db = getDb();
    const { fetchImpl, urls } = cvmFetch({ ipe: { 2026: ipeFixture }, fca: { 2026: fcaFixture } });

    const result = await ingestCvmFilings(db, OCTOBER_NIGHT, fetchImpl);

    expect(result).toBe(14);
    expect(urls.filter((url) => url.includes("/IPE/"))).toHaveLength(1);
    const recent = await recentCompanyFilings(db, "PETR4");
    expect(recent.mapped).toBe(true);
    expect(recent.filings.map((filing) => [filing.deliveredOn, filing.category])).toEqual([
      ["2026-07-31", "material_fact"],
      ["2026-04-28", "shareholder_meeting"],
      ["2026-03-13", "shareholder_meeting"],
      ["2026-02-10", "material_fact"],
      ["2026-01-28", "material_fact"],
    ]);
    expect(await recentCompanyFilings(db, "PETR3")).toEqual(recent);
  });

  it("is idempotent: a second read of the same file writes nothing", async () => {
    const db = getDb();
    const { fetchImpl } = cvmFetch({ ipe: { 2026: ipeFixture }, fca: { 2026: fcaFixture } });
    await ingestCvmFilings(db, OCTOBER_NIGHT, fetchImpl);

    const second = await ingestCvmFilings(db, OCTOBER_NIGHT, fetchImpl);

    expect(second).toBe(0);
    const rows = await db
      .select()
      .from(companyFilings)
      .where(inArray(companyFilings.cnpj, FIXTURE_CNPJS));
    expect(rows).toHaveLength(9);
  });

  it("shows only a protocol's newest version once CVM re-presents it", async () => {
    const db = getDb();
    const protocol = "009512IPE280720260274877668-50";
    await ingestCvmFilings(
      db,
      OCTOBER_NIGHT,
      cvmFetch({ ipe: { 2026: ipeFixture }, fca: { 2026: fcaFixture } }).fetchImpl,
    );

    await ingestCvmFilings(
      db,
      OCTOBER_NIGHT,
      cvmFetch({
        ipe: { 2026: withVersion(ipeFixture, protocol, 3, "2026-08-05") },
        fca: { 2026: fcaFixture },
      }).fetchImpl,
    );

    const recent = await recentCompanyFilings(db, "PETR4");
    const versions = recent.filings.filter((filing) => filing.protocol === protocol);
    expect(versions).toEqual([
      expect.objectContaining({
        version: 3,
        subject: "Reapresentação 3",
        deliveredOn: "2026-08-05",
      }),
    ]);
  });

  it("skips rows delivered more than 30 days before the newest stored filing", async () => {
    const db = getDb();
    const protocol = "009512IPE100220260185205247-68";
    await ingestCvmFilings(
      db,
      OCTOBER_NIGHT,
      cvmFetch({ ipe: { 2026: ipeFixture }, fca: { 2026: fcaFixture } }).fetchImpl,
    );
    const latest = await latestFilingDeliveredOn(db);

    const result = await ingestCvmFilings(
      db,
      OCTOBER_NIGHT,
      cvmFetch({
        ipe: { 2026: withVersion(ipeFixture, protocol, 2, "2026-02-11") },
        fca: { 2026: fcaFixture },
      }).fetchImpl,
    );

    expect(latest).toBe("2026-08-27");
    expect(result).toBe(0);
  });

  it("reads last year's file too until April, and the newer FCA wins a ticker", async () => {
    const db = getDb();
    const movedFca = fcaFixture.replace("33.592.510/0001-54", "33.000.167/0001-01");
    const { fetchImpl, urls } = cvmFetch({
      ipe: { 2025: ipeFixture, 2026: ipeFixture.split("\r\n")[0] ?? "" },
      fca: { 2025: movedFca.replaceAll("2026-01-01", "2025-01-01"), 2026: fcaFixture },
    });

    await ingestCvmFilings(db, new Date("2026-02-10T23:00:00.000Z"), fetchImpl);

    expect(urls.filter((url) => url.includes("/IPE/")).sort()).toEqual([
      expect.stringContaining("ipe_cia_aberta_2025.zip"),
      expect.stringContaining("ipe_cia_aberta_2026.zip"),
    ]);
    const [vale] = await db
      .select()
      .from(companyTickers)
      .where(inArray(companyTickers.ticker, ["VALE3"]));
    expect(vale?.cnpj).toBe("33592510000154");
  });

  it("reports pending while CVM has not generated this year's file", async () => {
    const db = getDb();
    const { fetchImpl } = cvmFetch({ fca: { 2026: fcaFixture } });

    const result = await ingestCvmFilings(db, OCTOBER_NIGHT, fetchImpl);

    expect(result).toEqual({ rowCount: 5, pending: true });
  });

  it("fails when neither this nor last year's FCA exists", async () => {
    const db = getDb();
    const { fetchImpl } = cvmFetch({ ipe: { 2026: ipeFixture } });

    await expect(ingestCvmFilings(db, OCTOBER_NIGHT, fetchImpl)).rejects.toThrow(/FCA/);
  });

  it("leaves nothing behind when a run is cut short, so the next one reads the whole file", async () => {
    const db = getDb();
    const { fetchImpl } = cvmFetch({ ipe: { 2026: ipeFixture }, fca: { 2026: fcaFixture } });
    cutShort.afterRows = 3;

    await expect(ingestCvmFilings(db, OCTOBER_NIGHT, fetchImpl)).rejects.toThrow("cut short");
    expect(await latestFilingDeliveredOn(db)).toBeUndefined();

    cutShort.afterRows = undefined;
    expect(await ingestCvmFilings(db, OCTOBER_NIGHT, fetchImpl)).toBe(14);
  });

  it("drops a delivery date past today and counts it, so the cutoff stays put", async () => {
    const db = getDb();
    const garbled = withVersion(ipeFixture, "009512IPE280720260274877668-50", 3, "2126-02-11");
    const content = [ipeFixture, garbled.split("\r\n")[1]].join("\r\n");

    const result = await ingestCvmFilings(
      db,
      OCTOBER_NIGHT,
      cvmFetch({ ipe: { 2026: content }, fca: { 2026: fcaFixture } }).fetchImpl,
    );

    expect(result).toEqual({ rowCount: 14, skippedRows: 1 });
    expect(await latestFilingDeliveredOn(db)).toBe("2026-08-27");
  });

  it("never lets an older FCA row re-point a stored ticker", async () => {
    const db = getDb();
    await ingestCvmFilings(
      db,
      OCTOBER_NIGHT,
      cvmFetch({ ipe: { 2026: ipeFixture }, fca: { 2026: fcaFixture } }).fetchImpl,
    );
    const olderClaim = fcaFixture
      .replace("33.592.510/0001-54", "33.000.167/0001-01")
      .replaceAll("2026-01-01", "2025-01-01");

    await ingestCvmFilings(
      db,
      OCTOBER_NIGHT,
      cvmFetch({ ipe: { 2026: ipeFixture }, fca: { 2025: olderClaim } }).fetchImpl,
    );

    const [vale] = await db
      .select()
      .from(companyTickers)
      .where(inArray(companyTickers.ticker, ["VALE3"]));
    expect(vale).toMatchObject({ cnpj: "33592510000154", referenceDate: "2026-01-01" });
  });

  it("says a ticker with no company behind it is unmapped", async () => {
    const db = getDb();

    expect(await recentCompanyFilings(db, "BOVA11")).toEqual({ mapped: false, filings: [] });
  });
});
