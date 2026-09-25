import { strFromU8, unzipSync } from "fflate";

export type Cell = { type: "number" | "string"; value: string } | null;

export type XlsxReadResult = { ok: true; rows: Cell[][] } | { ok: false; error: "not_xlsx" };

// ADR-0021 item 7: the inflated XML this reader will hold in memory. A B3
// export of a year of trades is well under 1 MB inflated.
const MAX_INFLATED_BYTES = 10 * 1024 * 1024;

const WORKBOOK = "xl/workbook.xml";
const WORKBOOK_RELS = "xl/_rels/workbook.xml.rels";
const SHARED_STRINGS = "xl/sharedStrings.xml";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return ENTITIES[entity] ?? match;
  });
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes);
  return match ? decodeXml(match[1] ?? "") : null;
}

function textRuns(xml: string): string {
  let text = "";
  const withoutPhonetics = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  for (const match of withoutPhonetics.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    text += decodeXml(match[1] ?? "");
  }
  return text;
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) {
    return [];
  }
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((match) => textRuns(match[1] ?? ""));
}

function firstSheetPath(workbook: string, rels: string): string | null {
  const sheet = /<sheet\b([^>]*)\/?>/.exec(workbook);
  const relationId = sheet ? attribute(sheet[1] ?? "", "r:id") : null;
  if (!relationId) {
    return null;
  }
  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attributes = match[1] ?? "";
    if (attribute(attributes, "Id") === relationId) {
      const target = attribute(attributes, "Target");
      if (!target) {
        return null;
      }
      return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    }
  }
  return null;
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? "";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function cellValue(attributes: string, body: string, strings: string[]): Cell {
  const type = attribute(attributes, "t");
  const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
  switch (type) {
    case "s": {
      const value = raw === undefined ? undefined : strings[Number.parseInt(raw, 10)];
      return value === undefined ? null : { type: "string", value };
    }
    case "inlineStr":
      return { type: "string", value: textRuns(body) };
    case "str":
      return raw === undefined ? null : { type: "string", value: decodeXml(raw) };
    case "e":
      return null;
    default:
      return raw === undefined ? null : { type: "number", value: raw.trim() };
  }
}

function sheetRows(xml: string, strings: string[]): Cell[][] {
  const rows: Cell[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: Cell[] = [];
    let next = 0;
    for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1] ?? "";
      const reference = attribute(attributes, "r");
      const index = reference ? columnIndex(reference) : next;
      while (cells.length < index) {
        cells.push(null);
      }
      cells[index] = cellValue(attributes, cell[2] ?? "", strings);
      next = index + 1;
    }
    rows.push(cells);
  }
  return rows;
}

// A minimal OOXML reader (ADR-0021 item 7): the first worksheet's cells as
// strings or raw numeric text, nothing else (no styles, formulas or dates).
export function readFirstSheet(bytes: Uint8Array): XlsxReadResult {
  let inflated = 0;
  const wanted = (name: string) =>
    name === WORKBOOK ||
    name === WORKBOOK_RELS ||
    name === SHARED_STRINGS ||
    name.startsWith("xl/worksheets/");
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (!wanted(file.name)) {
          return false;
        }
        inflated += file.originalSize;
        return inflated <= MAX_INFLATED_BYTES;
      },
    });
  } catch {
    return { ok: false, error: "not_xlsx" };
  }
  if (inflated > MAX_INFLATED_BYTES) {
    return { ok: false, error: "not_xlsx" };
  }

  const workbook = entries[WORKBOOK];
  const rels = entries[WORKBOOK_RELS];
  if (!workbook || !rels) {
    return { ok: false, error: "not_xlsx" };
  }
  const sheetPath = firstSheetPath(strFromU8(workbook), strFromU8(rels));
  const sheet = sheetPath ? entries[sheetPath] : undefined;
  if (!sheet) {
    return { ok: false, error: "not_xlsx" };
  }
  const stringsEntry = entries[SHARED_STRINGS];
  const strings = sharedStrings(stringsEntry ? strFromU8(stringsEntry) : undefined);
  return { ok: true, rows: sheetRows(strFromU8(sheet), strings) };
}
