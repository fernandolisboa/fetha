const RAD_HOST = "www.rad.cvm.gov.br";
// A filing above this is a scanned prospectus, not a notice; it stays
// unlabelled rather than costing a large document's tokens (docs/adr/0065).
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const PDF_MAGIC = "%PDF-";
// A file without its end marker was cut short in transit; it is retried
// rather than sent to the model as a broken document.
const PDF_END = "%%EOF";
const PDF_TAIL_BYTES = 2048;

export type FilingDocument =
  | { kind: "pdf"; bytes: Uint8Array }
  // RAD answered with its HTML shell instead of the file, or did not answer:
  // it throttles bursts, so the next run tries again.
  | { kind: "unavailable" }
  | { kind: "not_pdf" }
  | { kind: "too_large" };

export function isRadDocumentUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === RAD_HOST;
  } catch {
    return false;
  }
}

async function readBounded(body: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > MAX_DOCUMENT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// RAD serves every file as `text/html`, so the type is read from the bytes.
// fetch's default `Accept-Encoding: gzip` matters: without it the
// monitoring script RAD injects into "HTML" responses cuts the file short.
export async function fetchFilingDocument(
  url: string,
  fetchImpl: typeof fetch,
): Promise<FilingDocument> {
  if (!isRadDocumentUrl(url)) {
    return { kind: "not_pdf" };
  }
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  } catch {
    return { kind: "unavailable" };
  }
  if (!response.ok || !response.body) {
    return { kind: "unavailable" };
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_DOCUMENT_BYTES) {
    await response.body.cancel();
    return { kind: "too_large" };
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await readBounded(response.body);
  } catch {
    return { kind: "unavailable" };
  }
  if (bytes === null) {
    return { kind: "too_large" };
  }
  // An empty or cut-off answer under load is RAD failing, not the file.
  if (bytes.byteLength < PDF_MAGIC.length) {
    return { kind: "unavailable" };
  }
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 512)).trimStart();
  if (head.startsWith(PDF_MAGIC)) {
    const tail = new TextDecoder("latin1").decode(bytes.subarray(-PDF_TAIL_BYTES));
    return tail.includes(PDF_END) ? { kind: "pdf", bytes } : { kind: "unavailable" };
  }
  if (head.startsWith("<")) {
    return { kind: "unavailable" };
  }
  return { kind: "not_pdf" };
}
