import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CvmFileFormatError, parseFcaTickers, parseIpeFilings } from "./parser";

// Recorded from dados.cvm.gov.br on 2026-10-13 (ipe_cia_aberta_2026.zip and
// fca_cia_aberta_2026.zip, both regenerated 2026-10-11): real rows, kept
// latin1 with CRLF line ends as CVM ships them.
function readFixture(name: string): string {
  return readFileSync(path.join(import.meta.dirname, "fixtures", name), { encoding: "latin1" });
}

const ipeFixture = readFixture("ipe-sample.csv");
const fcaFixture = readFixture("fca-valor-mobiliario-sample.csv");

const IPE_HEADER =
  "CNPJ_Companhia;Nome_Companhia;Codigo_CVM;Data_Referencia;Categoria;Tipo;Especie;Assunto;Data_Entrega;Tipo_Apresentacao;Protocolo_Entrega;Versao;Link_Download";
const RAD_LINK =
  "https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?Tela=ext&descTipo=IPE&CodigoInstituicao=1&numProtocolo=1&numSequencia=1&numVersao=1";

function ipeRow(overrides: Partial<Record<string, string>> = {}): string {
  const values: Record<string, string> = {
    CNPJ_Companhia: "33.000.167/0001-01",
    Nome_Companhia: "PETROLEO BRASILEIRO S.A. PETROBRAS",
    Codigo_CVM: "9512",
    Data_Referencia: "2026-10-01",
    Categoria: "Fato Relevante",
    Tipo: "",
    Especie: "",
    Assunto: "Assunto",
    Data_Entrega: "2026-10-01",
    Tipo_Apresentacao: "AP - Apresentação",
    Protocolo_Entrega: "009512IPE011020260100000000-01",
    Versao: "1",
    Link_Download: RAD_LINK,
    ...overrides,
  };
  return IPE_HEADER.split(";")
    .map((column) => values[column] ?? "")
    .join(";");
}

describe("parseIpeFilings", () => {
  it("keeps the four categories, drops meeting ballots, placeholders and duplicates", () => {
    const { filings, skipped } = parseIpeFilings(ipeFixture);

    expect(skipped).toBe(0);
    expect(filings.map((filing) => filing.protocol)).toEqual([
      "009512IPE280120260137027168-94",
      "009512IPE100220260185205247-68",
      "009512IPE280720260274877668-50",
      "004170IPE120120260160641669-14",
      "004170IPE300420260196468480-42",
      "009512IPE160420260160029146-20",
      "009512IPE160420260148201974-79",
      "014451IPE200820260170018973-72",
      "080152IPE300420260193312515-18",
    ]);
  });

  it("maps a row to digits-only CNPJ, closed category and the RAD link", () => {
    const { filings } = parseIpeFilings(ipeFixture);

    expect(filings[0]).toEqual({
      protocol: "009512IPE280120260137027168-94",
      version: 1,
      cnpj: "33000167000101",
      companyName: "PETRÓLEO BRASILEIRO S.A. - PETROBRAS",
      category: "material_fact",
      kind: null,
      subject: "Petrobras aumenta Reservas Provadas em 2025",
      deliveredOn: "2026-01-28",
      documentUrl:
        "https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?Tela=ext&descTipo=IPE&CodigoInstituicao=1&numProtocolo=1470713&numSequencia=995419&numVersao=1",
    });
  });

  it("joins a meeting's type and species into its kind and splits `||` subjects", () => {
    const { filings } = parseIpeFilings(ipeFixture);
    const notice = filings.find((filing) => filing.protocol === "009512IPE160420260160029146-20");
    const minutes = filings.find((filing) => filing.protocol === "014451IPE200820260170018973-72");

    expect(notice?.category).toBe("shareholder_meeting");
    expect(notice?.kind).toBe("AGO · Edital de Convocação");
    expect(minutes?.subject).not.toContain("||");
    expect(minutes?.subject).toContain("; ");
  });

  it("keeps a comunicado's type as its kind", () => {
    const { filings } = parseIpeFilings(ipeFixture);
    const notice = filings.find((filing) => filing.protocol === "004170IPE120120260160641669-14");

    expect(notice?.category).toBe("market_notice");
    expect(notice?.kind).toBe("Apresentações a analistas/agentes do mercado");
  });

  it("decodes latin1 names", () => {
    const { filings } = parseIpeFilings(ipeFixture);

    expect(filings.some((filing) => filing.subject.includes("Produção"))).toBe(true);
  });

  it("rejects a link off CVM's RAD host instead of storing it", () => {
    const content = [
      IPE_HEADER,
      ipeRow({ Link_Download: "javascript:alert(1)" }),
      ipeRow({
        Protocolo_Entrega: "009512IPE011020260100000000-02",
        Link_Download: "https://evil.example/frmDownloadDocumento.aspx",
      }),
      ipeRow({
        Protocolo_Entrega: "009512IPE011020260100000000-03",
        Link_Download: RAD_LINK.replace("https:", "http:"),
      }),
    ].join("\n");

    expect(parseIpeFilings(content)).toEqual({ filings: [], skipped: 3 });
  });

  it("counts a line with the wrong field count as malformed", () => {
    const content = [IPE_HEADER, ipeRow(), "a;b;c"].join("\n");

    expect(parseIpeFilings(content).skipped).toBe(1);
  });

  it("fails the whole file once more than 20 in-scope rows are malformed", () => {
    const rows = Array.from({ length: 21 }, (_, index) =>
      ipeRow({ Protocolo_Entrega: `P-${String(index)}`, Data_Entrega: "not a date" }),
    );

    expect(() => parseIpeFilings([IPE_HEADER, ...rows].join("\n"))).toThrow(CvmFileFormatError);
  });

  it("fails on a file missing a column it reads", () => {
    expect(() => parseIpeFilings("CNPJ_Companhia;Categoria\n1;Fato Relevante")).toThrow(
      CvmFileFormatError,
    );
  });
});

describe("parseFcaTickers", () => {
  it("maps share codes to their company's CNPJ and drops non-codes", () => {
    const { tickers, skipped } = parseFcaTickers(fcaFixture);

    expect(skipped).toBe(0);
    expect(tickers).toEqual([
      { ticker: "PETR3", cnpj: "33000167000101", referenceDate: "2026-01-01" },
      { ticker: "PETR4", cnpj: "33000167000101", referenceDate: "2026-01-01" },
      { ticker: "VALE3", cnpj: "33592510000154", referenceDate: "2026-01-01" },
      { ticker: "TGMA3", cnpj: "02351144000118", referenceDate: "2026-01-01" },
    ]);
  });

  it("drops debentures even when their code looks like a share code", () => {
    const header = fcaFixture.split(/\r?\n/)[0] ?? "";
    const columns = header.split(";");
    const row = columns
      .map((column) => {
        switch (column) {
          case "CNPJ_Companhia":
            return "33.000.167/0001-01";
          case "Data_Referencia":
            return "2026-01-01";
          case "Valor_Mobiliario":
            return "Debêntures";
          case "Codigo_Negociacao":
            return "PETR16";
          default:
            return "";
        }
      })
      .join(";");

    expect(parseFcaTickers([header, row].join("\n")).tickers).toEqual([]);
  });

  it("keeps the newest reference date when two companies list the same code", () => {
    const header = "CNPJ_Companhia;Data_Referencia;Valor_Mobiliario;Codigo_Negociacao";
    const content = [
      header,
      "11.111.111/0001-11;2026-03-01;Ações Ordinárias;ABCD3",
      "22.222.222/0001-22;2026-05-01;Ações Ordinárias;ABCD3",
      "33.333.333/0001-33;2026-04-01;Ações Ordinárias;ABCD3",
    ].join("\n");

    expect(parseFcaTickers(content).tickers).toEqual([
      { ticker: "ABCD3", cnpj: "22222222000122", referenceDate: "2026-05-01" },
    ]);
  });
});
