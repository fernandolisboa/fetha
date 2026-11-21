import { describe, expect, it } from "vitest";
import { decimalStringSchema } from "@fetha/contracts";

import { formatDecimal } from "@/lib/format/decimal";
import { parsePriceInput } from "@/modules/portfolio";

// "Executei" prefills each leg's price with `formatDecimal` (review round 2, #381): the dialog
// never edits it unless the user does, so it must round-trip through `parsePriceInput`, the same
// pt-BR-only parser the submit path uses — a dot-decimal prefill (`DecimalString`'s own storage
// format) would fail every unedited submit.
describe("execute prefill price formatting", () => {
  it.each([["30.500000"], ["1234.5"], ["0.01"], ["10000"]])(
    "formats %s as pt-BR and parses it back",
    (raw) => {
      const price = decimalStringSchema.parse(raw);
      const formatted = formatDecimal(price, 2);
      // pt-BR uses `,` for the decimal separator (never `.`, which only ever appears here as a
      // thousands grouping dot, `parsePtBrDecimal`'s own distinction).
      expect(formatted).toContain(",");
      expect(parsePriceInput(formatted)).not.toBeNull();
    },
  );
});
