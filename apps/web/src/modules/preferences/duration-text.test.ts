import { describe, expect, it } from "vitest";

import { archiveDelayText } from "./duration-text";

describe("archiveDelayText", () => {
  it("names the delay in pt-BR, singular or plural", () => {
    expect(archiveDelayText(1)).toBe("1 minuto");
    expect(archiveDelayText(90)).toBe("90 minutos");
    expect(archiveDelayText(720)).toBe("12 horas");
    expect(archiveDelayText(1440)).toBe("1 dia");
    expect(archiveDelayText(10080)).toBe("1 semana");
    expect(archiveDelayText(1441)).toBe("1.441 minutos");
  });
});
