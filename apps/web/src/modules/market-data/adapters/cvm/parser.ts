import type { CompanyFilingCategory } from "../../schema";

import type { CompanyFiling, CompanyTicker } from "./schema";
import { companyFilingSchema, companyTickerSchema } from "./schema";

const IPE_CATEGORIES: ReadonlyMap<string, CompanyFilingCategory> = new Map([
  ["Fato Relevante", "material_fact"],
  ["Comunicado ao Mercado", "market_notice"],
  ["Aviso aos Acionistas", "shareholder_notice"],
  ["Assembleia", "shareholder_meeting"],
]);

// A meeting files up to ten documents (ballots, voting maps, manuals); the
// call notice, the board's proposal and the minutes are the ones that say
// what is decided (docs/adr/0060).
const MEETING_SPECIES = new Set(["Edital de Convocação", "Proposta da Administração", "Ata"]);

// Foreign issuers without a Brazilian CNPJ all share this placeholder, so a
// ticker mapped to it would collect every one of them's filings.
const PLACEHOLDER_CNPJ = "00000000000000";

const EQUITY_SECURITIES = new Set([
  "ações ordinárias",
  "ações preferenciais",
  "units",
  "certificados de depósito de valores mobiliários",
]);

// An in-scope row the schema rejects is a data-quality problem in the file;
// more than this many means a shifted or malformed file, not noise, and the
// whole snapshot fails instead of landing partially (same rule as the
// instruments registry, docs/adr/0017).
const MAX_SKIPPED_ROWS = 20;

export class CvmFileFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CvmFileFormatError";
  }
}

interface CsvTable {
  rows: string[][];
  // Lines whose field count differs from the header's; their leading fields
  // still say whether the line was in scope.
  malformed: string[][];
  column: (name: string) => number;
}

// CVM's open-data CSVs are `;`-delimited with no quoting: a field never holds
// a `;`, while `"` appears literally inside subjects.
function readCsv(content: string, file: string): CsvTable {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const [header, ...body] = lines;
  const columns = (header ?? "").split(";");
  const split = body.map((line) => line.split(";"));
  return {
    rows: split.filter((fields) => fields.length === columns.length),
    malformed: split.filter((fields) => fields.length !== columns.length),
    column: (name) => {
      const index = columns.indexOf(name);
      if (index === -1) {
        throw new CvmFileFormatError(`${file} missing column "${name}"`);
      }
      return index;
    },
  };
}

function digitsOf(value: string): string {
  return value.replaceAll(/\D/g, "");
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function subjectOf(raw: string | undefined): string {
  return (raw ?? "")
    .split("||")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("; ");
}

function isEquity(security: string | undefined): boolean {
  return EQUITY_SECURITIES.has(security?.trim().toLowerCase() ?? "");
}

function failOnTooManySkipped(skipped: number, file: string): void {
  if (skipped > MAX_SKIPPED_ROWS) {
    throw new CvmFileFormatError(`${file} has ${String(skipped)} malformed rows`);
  }
}

export interface ParsedCompanyFilings {
  filings: CompanyFiling[];
  skipped: number;
}

// "Cias Abertas: Documentos: Periódicos e Eventuais (IPE)", one file per
// delivery year (docs/adr/0060). Exact duplicate rows occur in the file, so
// the result is deduplicated on (protocol, version).
export function parseIpeFilings(content: string): ParsedCompanyFilings {
  const table = readCsv(content, "IPE");
  const cnpjIndex = table.column("CNPJ_Companhia");
  const nameIndex = table.column("Nome_Companhia");
  const categoryIndex = table.column("Categoria");
  const typeIndex = table.column("Tipo");
  const speciesIndex = table.column("Especie");
  const subjectIndex = table.column("Assunto");
  const deliveredIndex = table.column("Data_Entrega");
  const protocolIndex = table.column("Protocolo_Entrega");
  const versionIndex = table.column("Versao");
  const linkIndex = table.column("Link_Download");

  const byKey = new Map<string, CompanyFiling>();
  let skipped = table.malformed.filter((fields) =>
    IPE_CATEGORIES.has(fields[categoryIndex]?.trim() ?? ""),
  ).length;
  for (const fields of table.rows) {
    const category = IPE_CATEGORIES.get(fields[categoryIndex]?.trim() ?? "");
    if (!category) {
      continue;
    }
    const species = nonEmpty(fields[speciesIndex]);
    if (category === "shareholder_meeting" && (!species || !MEETING_SPECIES.has(species))) {
      continue;
    }
    const cnpj = digitsOf(fields[cnpjIndex] ?? "");
    if (cnpj === PLACEHOLDER_CNPJ) {
      continue;
    }
    const kind = [nonEmpty(fields[typeIndex]), species].filter(Boolean).join(" · ");
    const parsed = companyFilingSchema.safeParse({
      protocol: fields[protocolIndex]?.trim(),
      version: Number(fields[versionIndex]),
      cnpj,
      companyName: fields[nameIndex]?.trim(),
      category,
      kind: kind.length > 0 ? kind : null,
      subject: subjectOf(fields[subjectIndex]),
      deliveredOn: fields[deliveredIndex]?.trim(),
      documentUrl: fields[linkIndex]?.trim(),
    });
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    byKey.set(`${parsed.data.protocol}:${String(parsed.data.version)}`, parsed.data);
  }
  failOnTooManySkipped(skipped, "IPE");
  return { filings: [...byKey.values()], skipped };
}

export interface ParsedCompanyTickers {
  tickers: CompanyTicker[];
  skipped: number;
}

// The FCA's securities table (`fca_cia_aberta_valor_mobiliario_<year>.csv`)
// is the only open-data link from a CNPJ to its trading codes. The code is
// free text typed by the company ("NÃO HÁ", "N/A", "tgma3"), so it is
// normalized to upper case and kept only when it looks like a B3 share or
// unit code; debentures and other non-equity rows are dropped. Since any
// filer can type any code, a code two CNPJs claim in the same file is
// ambiguous and dropped, so the stored mapping stays as it was rather than
// letting one company re-point another's ticker (docs/adr/0060).
export function parseFcaTickers(content: string): ParsedCompanyTickers {
  const table = readCsv(content, "FCA");
  const cnpjIndex = table.column("CNPJ_Companhia");
  const referenceIndex = table.column("Data_Referencia");
  const securityIndex = table.column("Valor_Mobiliario");
  const codeIndex = table.column("Codigo_Negociacao");

  const byTicker = new Map<string, CompanyTicker>();
  const ambiguous = new Set<string>();
  let skipped = table.malformed.filter((fields) => isEquity(fields[securityIndex])).length;
  for (const fields of table.rows) {
    if (!isEquity(fields[securityIndex])) {
      continue;
    }
    const cnpj = digitsOf(fields[cnpjIndex] ?? "");
    if (cnpj === PLACEHOLDER_CNPJ) {
      continue;
    }
    const ticker = fields[codeIndex]?.trim().toUpperCase() ?? "";
    if (!/^[A-Z0-9]{4}\d{1,2}$/.test(ticker)) {
      continue;
    }
    const parsed = companyTickerSchema.safeParse({
      ticker,
      cnpj,
      referenceDate: fields[referenceIndex]?.trim(),
    });
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    const existing = byTicker.get(ticker);
    if (existing && existing.cnpj !== parsed.data.cnpj) {
      ambiguous.add(ticker);
    }
    if (!existing || parsed.data.referenceDate > existing.referenceDate) {
      byTicker.set(ticker, parsed.data);
    }
  }
  failOnTooManySkipped(skipped, "FCA");
  const tickers = [...byTicker.values()].filter((entry) => !ambiguous.has(entry.ticker));
  return { tickers, skipped: skipped + ambiguous.size };
}
