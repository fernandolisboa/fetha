import { and, desc, eq, gt, gte, inArray, max, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database, Transaction } from "@/db/client";
import { companyFilings, companyTickers, type CompanyFilingCategory } from "../schema";

import type { CompanyFiling, CompanyTicker } from "../adapters/cvm/schema";

const CHUNK_SIZE = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function latestFilingDeliveredOn(db: Database): Promise<string | undefined> {
  const [row] = await db.select({ latest: max(companyFilings.deliveredOn) }).from(companyFilings);
  return row?.latest ?? undefined;
}

// A (protocol, version) is immutable once CVM publishes it, so a row already
// stored is left alone; returns how many rows were new.
export async function insertCompanyFilings(
  db: Database | Transaction,
  filings: readonly CompanyFiling[],
): Promise<number> {
  let inserted = 0;
  for (const batch of chunk(filings, CHUNK_SIZE)) {
    const rows = await db
      .insert(companyFilings)
      .values(batch.map((filing) => ({ ...filing })))
      .onConflictDoNothing({ target: [companyFilings.protocol, companyFilings.version] })
      .returning({ protocol: companyFilings.protocol });
    inserted += rows.length;
  }
  return inserted;
}

// A row older than the stored mapping never re-points it: when this year's
// FCA drops a contested code, last year's row must not win it back
// (docs/adr/0060). Returns how many tickers were new or changed.
export async function upsertCompanyTickers(
  db: Database | Transaction,
  tickers: readonly CompanyTicker[],
): Promise<number> {
  let changed = 0;
  for (const batch of chunk(tickers, CHUNK_SIZE)) {
    const rows = await db
      .insert(companyTickers)
      .values(batch.map((ticker) => ({ ...ticker })))
      .onConflictDoUpdate({
        target: companyTickers.ticker,
        set: {
          cnpj: sql`excluded.cnpj`,
          referenceDate: sql`excluded.reference_date`,
          recordedAt: sql`now()`,
        },
        setWhere: sql`excluded.reference_date >= ${companyTickers.referenceDate} and (${companyTickers.cnpj} <> excluded.cnpj or ${companyTickers.referenceDate} <> excluded.reference_date)`,
      })
      .returning({ ticker: companyTickers.ticker });
    changed += rows.length;
  }
  return changed;
}

export interface CompanyFilingRow {
  protocol: string;
  version: number;
  category: CompanyFilingCategory;
  kind: string | null;
  subject: string;
  deliveredOn: string;
  documentUrl: string;
}

export interface RecentCompanyFilings {
  mapped: boolean;
  filings: CompanyFilingRow[];
}

const newerVersion = alias(companyFilings, "newer_version");

// The newest filings of the company behind `ticker`, each protocol at its
// highest stored version.
export async function recentCompanyFilings(
  db: Database,
  ticker: string,
  limit = 10,
): Promise<RecentCompanyFilings> {
  const [company] = await db
    .select({ cnpj: companyTickers.cnpj })
    .from(companyTickers)
    .where(eq(companyTickers.ticker, ticker))
    .limit(1);
  if (!company) {
    return { mapped: false, filings: [] };
  }
  const filings = await db
    .select({
      protocol: companyFilings.protocol,
      version: companyFilings.version,
      category: companyFilings.category,
      kind: companyFilings.kind,
      subject: companyFilings.subject,
      deliveredOn: companyFilings.deliveredOn,
      documentUrl: companyFilings.documentUrl,
    })
    .from(companyFilings)
    .where(
      and(
        eq(companyFilings.cnpj, company.cnpj),
        notExists(
          db
            .select({ protocol: newerVersion.protocol })
            .from(newerVersion)
            .where(
              and(
                eq(newerVersion.protocol, companyFilings.protocol),
                gt(newerVersion.version, companyFilings.version),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(companyFilings.deliveredOn), desc(companyFilings.protocol))
    .limit(limit);
  return { mapped: true, filings };
}

export interface CompanyOfTicker {
  ticker: string;
  cnpj: string;
  // The name on the company's newest stored filing; null before it files.
  companyName: string | null;
}

export async function companiesOfTickers(
  db: Database,
  tickers: readonly string[],
): Promise<CompanyOfTicker[]> {
  if (tickers.length === 0) {
    return [];
  }
  const rows = await db
    .select({ ticker: companyTickers.ticker, cnpj: companyTickers.cnpj })
    .from(companyTickers)
    .where(inArray(companyTickers.ticker, [...tickers]));
  if (rows.length === 0) {
    return [];
  }
  const names = await db
    .selectDistinctOn([companyFilings.cnpj], {
      cnpj: companyFilings.cnpj,
      companyName: companyFilings.companyName,
    })
    .from(companyFilings)
    .where(inArray(companyFilings.cnpj, [...new Set(rows.map((row) => row.cnpj))]))
    .orderBy(companyFilings.cnpj, desc(companyFilings.deliveredOn));
  const nameOf = new Map(names.map((row) => [row.cnpj, row.companyName]));
  return rows
    .map((row) => ({ ...row, companyName: nameOf.get(row.cnpj) ?? null }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export interface CompanyFilingOfCompany extends CompanyFilingRow {
  cnpj: string;
  companyName: string;
}

// Every filing of these companies delivered on or after `since`, each
// protocol at its highest stored version, newest first.
export async function filingsOfCompaniesSince(
  db: Database,
  cnpjs: readonly string[],
  since: string,
): Promise<CompanyFilingOfCompany[]> {
  if (cnpjs.length === 0) {
    return [];
  }
  return db
    .select({
      protocol: companyFilings.protocol,
      version: companyFilings.version,
      cnpj: companyFilings.cnpj,
      companyName: companyFilings.companyName,
      category: companyFilings.category,
      kind: companyFilings.kind,
      subject: companyFilings.subject,
      deliveredOn: companyFilings.deliveredOn,
      documentUrl: companyFilings.documentUrl,
    })
    .from(companyFilings)
    .where(
      and(
        inArray(companyFilings.cnpj, [...cnpjs]),
        gte(companyFilings.deliveredOn, since),
        notExists(
          db
            .select({ protocol: newerVersion.protocol })
            .from(newerVersion)
            .where(
              and(
                eq(newerVersion.protocol, companyFilings.protocol),
                gt(newerVersion.version, companyFilings.version),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(companyFilings.deliveredOn), desc(companyFilings.protocol));
}
