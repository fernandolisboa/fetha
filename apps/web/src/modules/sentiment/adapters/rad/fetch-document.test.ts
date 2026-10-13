import { describe, expect, it, vi } from "vitest";

import { fetchFilingDocument, isRadDocumentUrl, MAX_DOCUMENT_BYTES } from "./fetch-document";

const URL_OK =
  "https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?Tela=ext&numProtocolo=1&descTipo=IPE&CodigoInstituicao=1";

function pdf(body = "1 0 obj\n<<>>\nendobj\n", end = "%%EOF\n"): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`%PDF-1.7\n${body}${end}`);
}

function fakeFetch(body: BodyInit, init: ResponseInit = {}) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(body, init)));
}

describe("isRadDocumentUrl", () => {
  it.each([
    [URL_OK, true],
    ["http://www.rad.cvm.gov.br/ENET/x", false],
    ["https://rad.cvm.gov.br.evil.example/ENET/x", false],
    ["https://evil.example/?u=https://www.rad.cvm.gov.br", false],
    ["not a url", false],
  ])("%s → %s", (url, expected) => {
    expect(isRadDocumentUrl(url)).toBe(expected);
  });
});

describe("fetchFilingDocument", () => {
  it("returns the bytes of a complete PDF, whatever content type RAD declares", async () => {
    const bytes = pdf();
    const fetchImpl = fakeFetch(bytes, { headers: { "content-type": "text/html" } });
    const document = await fetchFilingDocument(URL_OK, fetchImpl);
    expect(document).toEqual({ kind: "pdf", bytes });
    expect(fetchImpl).toHaveBeenCalledWith(URL_OK, expect.objectContaining({ redirect: "error" }));
  });

  it("never requests a host other than RAD", async () => {
    const fetchImpl = fakeFetch(pdf());
    expect(await fetchFilingDocument("https://evil.example/doc.pdf", fetchImpl)).toEqual({
      kind: "not_pdf",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads RAD's HTML shell as unavailable, so the next run retries", async () => {
    const html = "<html><body>Aguarde</body></html>";
    expect(await fetchFilingDocument(URL_OK, fakeFetch(html))).toEqual({ kind: "unavailable" });
  });

  it("reads a PDF cut short in transit as unavailable", async () => {
    expect(await fetchFilingDocument(URL_OK, fakeFetch(pdf("stream\n", "")))).toEqual({
      kind: "unavailable",
    });
  });

  it("reads an empty answer as unavailable, not as an unreadable file", async () => {
    expect(await fetchFilingDocument(URL_OK, fakeFetch(""))).toEqual({ kind: "unavailable" });
  });

  it("treats a non-PDF file as unreadable", async () => {
    const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(await fetchFilingDocument(URL_OK, fakeFetch(docx))).toEqual({ kind: "not_pdf" });
  });

  it("refuses a body over the cap, declared or streamed", async () => {
    const declared = fakeFetch(pdf(), {
      headers: { "content-length": String(MAX_DOCUMENT_BYTES + 1) },
    });
    expect(await fetchFilingDocument(URL_OK, declared)).toEqual({ kind: "too_large" });

    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
        if (sent > 11) {
          controller.close();
        }
      },
    });
    expect(await fetchFilingDocument(URL_OK, fakeFetch(stream))).toEqual({
      kind: "too_large",
    });
  });

  it("reads an error status, a network failure or a redirect as unavailable", async () => {
    expect(await fetchFilingDocument(URL_OK, fakeFetch("", { status: 503 }))).toEqual({
      kind: "unavailable",
    });
    const failing = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("redirect")));
    expect(await fetchFilingDocument(URL_OK, failing)).toEqual({ kind: "unavailable" });
  });
});
