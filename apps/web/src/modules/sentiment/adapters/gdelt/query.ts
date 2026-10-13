const LEGAL_SUFFIX = /\s+(S\.?\s?\/?\s?A\.?|LTDA\.?|CIA\.?)$/iu;
const MIN_KEYWORD_LENGTH = 3;
const MAX_TICKERS = 4;

// The trading name inside "PETRÓLEO BRASILEIRO S.A. - PETROBRAS", or the
// registered name without its legal suffix ("VALE S.A." → "vale").
export function companyKeyword(companyName: string): string | null {
  const parts = companyName.split(" - ");
  const tail = parts.length > 1 ? (parts.at(-1) ?? "") : companyName;
  const name = tail
    .replace(/["()]/gu, " ")
    .replace(LEGAL_SUFFIX, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
  return name.length >= MIN_KEYWORD_LENGTH ? name : null;
}

// docs/adr/0065: the company's name or any of its tickers, in Portuguese
// sources. A common-word name ("vale") is noisy, which the panel says.
export function gdeltQuery(companyName: string | null, tickers: readonly string[]): string | null {
  const keyword = companyName ? companyKeyword(companyName) : null;
  const terms = [
    ...(keyword ? [`"${keyword}"`] : []),
    ...[...tickers]
      .sort()
      .slice(0, MAX_TICKERS)
      .map((ticker) => ticker.toLowerCase()),
  ];
  const [only, ...rest] = terms;
  if (only === undefined) {
    return null;
  }
  const block = rest.length === 0 ? only : `(${terms.join(" OR ")})`;
  return `${block} sourcelang:portuguese`;
}
