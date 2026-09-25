import { describe, expect, it } from "vitest";

import { parsePtBrDecimal } from "./parse-decimal";

describe("parsePtBrDecimal", () => {
  it("reads `.` as the thousands separator and `,` as the decimal one", () => {
    expect(parsePtBrDecimal("10.000", 2)?.toFixed()).toBe("10000");
    expect(parsePtBrDecimal("1.234,56", 2)?.toFixed()).toBe("1234.56");
    expect(parsePtBrDecimal(" 38,42 ", 2)?.toFixed()).toBe("38.42");
  });

  it("refuses more decimals than allowed and malformed grouping", () => {
    expect(parsePtBrDecimal("1,234", 2)).toBeNull();
    expect(parsePtBrDecimal("1,234", 3)?.toFixed()).toBe("1.234");
    expect(parsePtBrDecimal("12.34", 2)).toBeNull();
    expect(parsePtBrDecimal("-1", 2)).toBeNull();
    expect(parsePtBrDecimal("", 2)).toBeNull();
  });
});
