import { readFileSync } from "node:fs";
import path from "node:path";

import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { parseNegotiationRows } from "./parse-negotiation";
import { readFirstSheet, type Cell } from "./read-xlsx";

const fixture = new Uint8Array(
  readFileSync(path.join(import.meta.dirname, "fixtures", "negociacao.xlsx")),
);

function s(value: string): Cell {
  return { type: "string", value };
}
function n(value: string): Cell {
  return { type: "number", value };
}

const HEADER = [
  s("Data do Negócio"),
  s("Tipo de Movimentação"),
  s("Mercado"),
  s("Prazo/Vencimento"),
  s("Instituição"),
  s("Código de Negociação"),
  s("Quantidade"),
  s("Preço"),
  s("Valor"),
];

function row(overrides: Partial<Record<number, Cell>> = {}): Cell[] {
  const base = [
    s("15/09/2026"),
    s("Compra"),
    s("Mercado à Vista"),
    s("-"),
    s("XP"),
    s("PETR4"),
    n("100"),
    n("30.5"),
    n("3050"),
  ];
  return base.map((cell, index) => (index in overrides ? (overrides[index] ?? null) : cell));
}

describe("readFirstSheet", () => {
  it("reads the recorded fixture's header and rows", () => {
    const result = readFirstSheet(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.map((cell) => cell?.value)).toEqual(HEADER.map((cell) => cell?.value));
    expect(result.rows[1]?.[5]).toEqual({ type: "string", value: "PETRJ320" });
    expect(result.rows[1]?.[7]).toEqual({ type: "number", value: "1.2" });
    expect(result.rows).toHaveLength(9);
  });

  it("refuses bytes that are not a workbook", () => {
    expect(readFirstSheet(strToU8("Data do Negócio;Mercado"))).toEqual({
      ok: false,
      error: "not_xlsx",
    });
    expect(readFirstSheet(zipSync({ "hello.txt": strToU8("hi") }))).toEqual({
      ok: false,
      error: "not_xlsx",
    });
  });

  it("reads inline strings, entities and sparse cells", () => {
    const workbook = zipSync({
      "xl/workbook.xml": strToU8(
        '<workbook><sheets><sheet name="a" r:id="rId7"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<Relationships><Relationship Id="rId7" Target="/xl/worksheets/other.xml"/></Relationships>',
      ),
      "xl/worksheets/other.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>P&amp;L &#231;</t></is></c><c r="C1"><v>7</v></c></row><row r="2"/></sheetData></worksheet>',
      ),
    });
    const result = readFirstSheet(workbook);
    expect(result).toEqual({
      ok: true,
      rows: [[{ type: "string", value: "P&L ç" }, null, { type: "number", value: "7" }], []],
    });
  });
});

describe("parseNegotiationRows", () => {
  it("parses the recorded fixture into fills, oldest first, counting skipped rows", () => {
    const sheet = readFirstSheet(fixture);
    if (!sheet.ok) throw new Error("fixture unreadable");
    const result = parseNegotiationRows(sheet.rows);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toEqual({ exercise: 1, unsupported_market: 1 });
    expect(
      result.fills.map((fill) => [
        fill.session,
        fill.side,
        fill.assetClass,
        fill.ticker,
        fill.quantity,
        fill.price,
      ]),
    ).toEqual([
      ["2026-09-08", "buy", "option", "PETRV280", 100, "0.85"],
      ["2026-09-14", "buy", "stock", "VALE3", 7, "61.42"],
      ["2026-09-14", "buy", "stock", "VALE3", 100, "61.4"],
      ["2026-09-14", "buy", "stock", "VALE3", 100, "61.4"],
      ["2026-09-15", "sell", "option", "PETRJ320", 100, "1.2"],
      ["2026-09-15", "buy", "stock", "PETR4", 100, "30.5"],
    ]);
  });

  it("gives identical trades distinct, stable import keys", () => {
    const rows = [HEADER, row(), row()];
    const first = parseNegotiationRows(rows);
    const again = parseNegotiationRows(rows);
    if (!first.ok || !again.ok) throw new Error("unexpected parse failure");
    const keys = first.fills.map((fill) => fill.importKey);
    expect(new Set(keys).size).toBe(2);
    expect(again.fills.map((fill) => fill.importKey)).toEqual(keys);
  });

  it("keys a row the same way inside an overlapping export", () => {
    const earlier = row({ 0: s("14/09/2026") });
    const alone = parseNegotiationRows([HEADER, row()]);
    const overlapping = parseNegotiationRows([HEADER, row(), earlier]);
    if (!alone.ok || !overlapping.ok) throw new Error("unexpected parse failure");
    expect(overlapping.fills.map((fill) => fill.importKey)).toContain(alone.fills[0]?.importKey);
  });

  it("finds the header below a title and accepts pt-BR text numbers and serial dates", () => {
    const result = parseNegotiationRows([
      [s("Extrato de negociação")],
      [],
      HEADER,
      row({ 0: n("46280"), 6: s("1.000"), 7: s("R$ 12,34") }),
    ]);
    expect(result).toMatchObject({
      ok: true,
      fills: [{ session: "2026-09-15", quantity: 1000, price: "12.34" }],
    });
  });

  it("refuses a sheet without the required columns", () => {
    expect(
      parseNegotiationRows([
        [s("Data"), s("Ativo")],
        [s("x"), s("y")],
      ]),
    ).toEqual({
      ok: false,
      error: "missing_columns",
    });
  });

  it.each([
    ["an unknown side", { 1: s("Troca") }],
    ["an impossible date", { 0: s("31/02/2026") }],
    ["a fractional quantity", { 6: n("1.5") }],
    ["a negative price", { 7: n("-1") }],
    ["a malformed ticker", { 5: s("PETR 4") }],
  ])("reports the row number for %s", (_label, overrides) => {
    expect(parseNegotiationRows([HEADER, row(), row(overrides)])).toEqual({
      ok: false,
      error: "invalid_row",
      row: 3,
    });
  });
});
