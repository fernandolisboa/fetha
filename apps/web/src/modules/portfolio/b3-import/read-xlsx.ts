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

// Excel's last column (XFD) and a row ceiling far above a B3 export; past
// either the file is not a spreadsheet this reader should keep in memory.
const MAX_COLUMN_INDEX = 16_383;
const MAX_ROWS = 20_000;
const MAX_CODE_POINT = 0x10ffff;

class MalformedXlsx extends Error {}

function codePoint(value: number): string {
  if (!Number.isInteger(value) || value > MAX_CODE_POINT || (value >= 0xd800 && value <= 0xdfff)) {
    throw new MalformedXlsx();
  }
  return String.fromCodePoint(value);
}

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|\w{1,8});/g, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      return codePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return codePoint(Number.parseInt(entity.slice(1), 10));
    }
    return ENTITIES[entity] ?? match;
  });
}

interface Element {
  attributes: string;
  body: string;
}

// Every `<tag ...>body</tag>` or `<tag .../>` in document order, scanned with
// indexOf so the cost stays linear in the input: a backtracking regex over
// an unclosed tag rescans to the end of the input for every occurrence.
function elements(xml: string, tag: string): Element[] {
  const found: Element[] = [];
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let from = 0;
  for (;;) {
    const start = xml.indexOf(open, from);
    if (start === -1) {
      return found;
    }
    const boundary = xml.charAt(start + open.length);
    if (boundary !== ">" && boundary !== "/" && !/\s/.test(boundary)) {
      from = start + open.length;
      continue;
    }
    const tagEnd = xml.indexOf(">", start);
    if (tagEnd === -1) {
      throw new MalformedXlsx();
    }
    const selfClosing = xml.charAt(tagEnd - 1) === "/";
    const attributes = xml.slice(start + open.length, selfClosing ? tagEnd - 1 : tagEnd);
    if (selfClosing) {
      found.push({ attributes, body: "" });
      from = tagEnd + 1;
      continue;
    }
    const end = xml.indexOf(close, tagEnd);
    if (end === -1) {
      throw new MalformedXlsx();
    }
    found.push({ attributes, body: xml.slice(tagEnd + 1, end) });
    from = end + close.length;
  }
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes);
  return match ? decodeXml(match[1] ?? "") : null;
}

function withoutPhonetics(xml: string): string {
  let kept = "";
  let from = 0;
  for (;;) {
    const start = xml.indexOf("<rPh", from);
    if (start === -1) {
      return kept + xml.slice(from);
    }
    const end = xml.indexOf("</rPh>", start);
    if (end === -1) {
      throw new MalformedXlsx();
    }
    kept += xml.slice(from, start);
    from = end + "</rPh>".length;
  }
}

function textRuns(xml: string): string {
  return elements(withoutPhonetics(xml), "t")
    .map((run) => decodeXml(run.body))
    .join("");
}

function sharedStrings(xml: string | undefined): string[] {
  return xml ? elements(xml, "si").map((item) => textRuns(item.body)) : [];
}

function firstSheetPath(workbook: string, rels: string): string | null {
  const [sheet] = elements(workbook, "sheet");
  const relationId = sheet ? attribute(sheet.attributes, "r:id") : null;
  if (!relationId) {
    return null;
  }
  for (const relation of elements(rels, "Relationship")) {
    if (attribute(relation.attributes, "Id") === relationId) {
      const target = attribute(relation.attributes, "Target");
      if (!target) {
        return null;
      }
      return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    }
  }
  return null;
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]{1,3}/.exec(reference)?.[0] ?? "";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  if (index - 1 > MAX_COLUMN_INDEX) {
    throw new MalformedXlsx();
  }
  return index - 1;
}

function valueOf(body: string): string | undefined {
  const [value] = elements(body, "v");
  return value?.body;
}

function cellValue(attributes: string, body: string, strings: string[]): Cell {
  const type = attribute(attributes, "t");
  const raw = valueOf(body);
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
  const rowElements = elements(xml, "row");
  if (rowElements.length > MAX_ROWS) {
    throw new MalformedXlsx();
  }
  return rowElements.map((row) => {
    const cells: Cell[] = [];
    let next = 0;
    for (const cell of elements(row.body, "c")) {
      const reference = attribute(cell.attributes, "r");
      const index = reference ? columnIndex(reference) : next;
      if (index > MAX_COLUMN_INDEX) {
        throw new MalformedXlsx();
      }
      while (cells.length < index) {
        cells.push(null);
      }
      cells[index] = cellValue(cell.attributes, cell.body, strings);
      next = index + 1;
    }
    return cells;
  });
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
  let sheetPath: string | null;
  try {
    sheetPath = firstSheetPath(strFromU8(workbook), strFromU8(rels));
  } catch (error) {
    if (error instanceof MalformedXlsx) {
      return { ok: false, error: "not_xlsx" };
    }
    throw error;
  }
  const sheet = sheetPath ? entries[sheetPath] : undefined;
  if (!sheet) {
    return { ok: false, error: "not_xlsx" };
  }
  const stringsEntry = entries[SHARED_STRINGS];
  try {
    const strings = sharedStrings(stringsEntry ? strFromU8(stringsEntry) : undefined);
    return { ok: true, rows: sheetRows(strFromU8(sheet), strings) };
  } catch (error) {
    if (error instanceof MalformedXlsx) {
      return { ok: false, error: "not_xlsx" };
    }
    throw error;
  }
}
