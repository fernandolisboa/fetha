// B3's legacy option series code: a root (the underlying's own ticker,
// without its own trailing class digit), one letter encoding both the
// option's right and its expiry month, then a sequence number B3 assigns
// that tells series apart and is never the strike (`reading-the-series-code`
// lesson). A through L mark a call, January through December in order; M
// through X mark a put, the same twelve months. Shared by the lesson's own
// placeholders and by a test that checks the illustrative tickers against
// this table, so the two can never drift apart.
const CALL_LETTERS = "ABCDEFGHIJKL";
const PUT_LETTERS = "MNOPQRSTUVWX";

export interface DecodedSeriesLetter {
  right: "call" | "put";
  month: number;
}

export function decodeSeriesLetter(letter: string): DecodedSeriesLetter {
  if (letter.length !== 1) {
    throw new Error(`"${letter}" is not a single B3 series-code month letter`);
  }
  const callIndex = CALL_LETTERS.indexOf(letter);
  if (callIndex >= 0) {
    return { right: "call", month: callIndex + 1 };
  }
  const putIndex = PUT_LETTERS.indexOf(letter);
  if (putIndex >= 0) {
    return { right: "put", month: putIndex + 1 };
  }
  throw new Error(`"${letter}" is not a B3 series-code month letter`);
}

// Only ever applied to this module's own fixed illustrative tickers, whose
// root is always the 4-letter "EXMP": the letter is the 5th character, the
// rest is the sequence number.
export function seriesLetterOf(ticker: string): string {
  const letter = ticker.charAt(4);
  if (letter === "") {
    throw new Error(`"${ticker}" is too short to carry a series letter`);
  }
  return letter;
}
