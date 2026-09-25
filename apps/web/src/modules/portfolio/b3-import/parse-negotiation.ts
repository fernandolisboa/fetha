import { createHash } from "node:crypto";

import Decimal from "decimal.js";
import {
  decimalStringSchema,
  quantitySchema,
  tickerSchema,
  type DecimalString,
  type Quantity,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";

import type { AssetClass, FillSide } from "../schema";

import type { Cell } from "./read-xlsx";

export interface ImportedFill {
  ticker: Ticker;
  assetClass: AssetClass;
  side: FillSide;
  quantity: Quantity;
  price: DecimalString;
  session: SessionDate;
  importKey: string;
}

export const skipReasons = ["exercise", "unsupported_market"] as const;
export type SkipReason = (typeof skipReasons)[number];

export type ParseNegotiationResult =
  | { ok: true; fills: ImportedFill[]; skipped: Record<SkipReason, number> }
  | { ok: false; error: "missing_columns" }
  | { ok: false; error: "invalid_row"; row: number };

const COLUMNS = {
  date: "data do negocio",
  side: "tipo de movimentacao",
  market: "mercado",
  institution: "instituicao",
  ticker: "codigo de negociacao",
  quantity: "quantidade",
  price: "preco",
} as const;

const REQUIRED: readonly (keyof typeof COLUMNS)[] = [
  "date",
  "side",
  "market",
  "ticker",
  "quantity",
  "price",
];

// Excel's day zero for serial dates (the 1900 leap-year bug makes it
// 1899-12-30 for every date after February 1900).
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function text(cell: Cell | undefined): string {
  return cell ? cell.value.trim() : "";
}

function headerIndexes(row: Cell[]): Partial<Record<keyof typeof COLUMNS, number>> {
  const indexes: Partial<Record<keyof typeof COLUMNS, number>> = {};
  row.forEach((cell, index) => {
    const name = normalize(text(cell));
    for (const [key, header] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
      if (name === header) {
        indexes[key] = index;
      }
    }
  });
  return indexes;
}

function parseSession(cell: Cell | undefined): SessionDate | null {
  if (!cell) {
    return null;
  }
  if (cell.type === "number") {
    const serial = Number(cell.value);
    if (!Number.isInteger(serial) || serial <= 0) {
      return null;
    }
    return new Date(EXCEL_EPOCH_MS + serial * MS_PER_DAY).toISOString().slice(0, 10);
  }
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cell.value.trim());
  if (!match) {
    return null;
  }
  const [, day = "", month = "", year = ""] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(iso) ? iso : null;
}

// Text cells use pt-BR separators; a "." is only ever a thousands separator,
// so "0.35" (a dot-decimal text cell) is refused rather than read as 35.
function ptBrNumber(text: string): string | null {
  const compact = text.replace(/R\$/g, "").replace(/\s/g, "");
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(compact)) {
    return null;
  }
  return compact.replace(/\./g, "").replace(",", ".");
}

function parseNumber(cell: Cell | undefined): Decimal | null {
  if (!cell) {
    return null;
  }
  const raw = cell.type === "number" ? cell.value : ptBrNumber(cell.value);
  if (raw === null) {
    return null;
  }
  try {
    const value = new Decimal(raw);
    return value.isFinite() ? value : null;
  } catch {
    return null;
  }
}

type MarketKind = { kind: AssetClass; fractional: boolean } | { kind: SkipReason };

function classifyMarket(market: string): MarketKind {
  const name = normalize(market);
  if (name === "mercado a vista") return { kind: "stock", fractional: false };
  if (name === "mercado fracionario") return { kind: "stock", fractional: true };
  if (name === "opcao de compra" || name === "opcao de venda") {
    return { kind: "option", fractional: false };
  }
  if (name.startsWith("exercicio")) return { kind: "exercise" };
  return { kind: "unsupported_market" };
}

function parseSide(value: string): FillSide | null {
  const name = normalize(value);
  if (name === "compra") return "buy";
  if (name === "venda") return "sell";
  return null;
}

// ADR-0021 item 7: the "Negociação" export of B3's investor area, columns
// found by header name. Skipped rows are counted, never silently dropped.
export function parseNegotiationRows(rows: readonly Cell[][]): ParseNegotiationResult {
  const headerRow = rows.findIndex((row) => {
    const indexes = headerIndexes(row);
    return REQUIRED.every((key) => indexes[key] !== undefined);
  });
  if (headerRow === -1) {
    return { ok: false, error: "missing_columns" };
  }
  const columns = headerIndexes(rows[headerRow] ?? []) as Record<keyof typeof COLUMNS, number>;

  const fills: ImportedFill[] = [];
  const skipped: Record<SkipReason, number> = { exercise: 0, unsupported_market: 0 };
  const occurrences = new Map<string, number>();

  for (let index = headerRow + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (row.every((cell) => text(cell ?? undefined) === "")) {
      continue;
    }
    const invalid = { ok: false as const, error: "invalid_row" as const, row: index + 1 };

    const market = classifyMarket(text(row[columns.market]));
    if (!("fractional" in market)) {
      skipped[market.kind] += 1;
      continue;
    }

    const session = parseSession(row[columns.date] ?? null);
    const side = parseSide(text(row[columns.side]));
    const rawTicker = text(row[columns.ticker]).toUpperCase();
    const ticker =
      market.fractional && rawTicker.endsWith("F") ? rawTicker.slice(0, -1) : rawTicker;
    const quantity = parseNumber(row[columns.quantity]);
    const price = parseNumber(row[columns.price]);
    const parsedTicker = tickerSchema.safeParse(ticker);
    const parsedQuantity = quantitySchema.safeParse(quantity?.toNumber());
    if (
      !session ||
      !side ||
      !parsedTicker.success ||
      !parsedQuantity.success ||
      !quantity?.isInteger() ||
      !price ||
      price.isNegative()
    ) {
      return invalid;
    }
    const normalizedPrice = decimalStringSchema.parse(price.toFixed());

    const identity = JSON.stringify([
      session,
      side,
      normalize(text(row[columns.market])),
      parsedTicker.data,
      parsedQuantity.data,
      price.toFixed(6),
      normalize(text(row[columns.institution])),
    ]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);

    fills.push({
      ticker: parsedTicker.data,
      assetClass: market.kind,
      side,
      quantity: parsedQuantity.data,
      price: normalizedPrice,
      session,
      importKey: createHash("sha256")
        .update(`${identity}#${String(occurrence)}`)
        .digest("hex"),
    });
  }

  fills.sort((a, b) => a.session.localeCompare(b.session));
  return { ok: true, fills, skipped };
}
