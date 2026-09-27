import { describe, expect, it } from "vitest";

import { ACCESS_LOG_RETENTION_DAYS } from "@/modules/audit";

import { ACCOUNT_BUCKET_RETENTION_SECONDS } from "./account-rate-limit";
import { legalText } from "./legal-text";
import { SESSION_EXPIRES_IN_DAYS } from "./expired-sessions";
import { CURRENT_TERMS_VERSION } from "./terms";
import { UNVERIFIED_ACCOUNT_RETENTION_HOURS } from "./unverified-accounts";

function versionDate(version: string): string {
  const [year, month, day] = version.slice(0, 10).split("-");
  return `${day ?? ""}/${month ?? ""}/${year ?? ""}`;
}

function fullText(language: keyof typeof legalText): string {
  const { terms, privacy } = legalText[language];
  return [terms, privacy]
    .flatMap((document) => document.sections.flatMap((section) => section.paragraphs))
    .join(" ");
}

describe("legal text", () => {
  it("dates both documents with the terms version users accept", () => {
    for (const language of ["en", "ptBR"] as const) {
      const { terms, privacy } = legalText[language];
      expect(terms.updated).toContain(versionDate(CURRENT_TERMS_VERSION));
      expect(privacy.updated).toContain(versionDate(CURRENT_TERMS_VERSION));
    }
  });

  it("ships the same structure in both languages", () => {
    for (const key of ["terms", "privacy"] as const) {
      const en = legalText.en[key].sections.map((section) => section.paragraphs.length);
      const ptBR = legalText.ptBR[key].sections.map((section) => section.paragraphs.length);
      expect(ptBR).toEqual(en);
    }
  });

  it("states that every decision is the user's own and who answers for a provider token", () => {
    const text = fullText("ptBR");
    expect(text).toContain("Toda decisão que você tomar");
    expect(text).toContain("token de um provedor de dados");
  });

  it("states the retention the code enforces", () => {
    const text = fullText("ptBR");
    expect(text).toContain(`${String(ACCESS_LOG_RETENTION_DAYS)} dias`);
    expect(text).toContain(
      `não for confirmado em ${String(UNVERIFIED_ACCOUNT_RETENTION_HOURS)} horas é apagada`,
    );
    expect(text).toContain("SHA-256");
    expect(text).toContain("Cada e-mail digitado no cadastro");
    expect(ACCOUNT_BUCKET_RETENTION_SECONDS).toBe(60);
    expect(text).toContain("depois de passado um minuto");
    expect(text).toContain(`no máximo ${String(SESSION_EXPIRES_IN_DAYS)} dias sem uso`);
  });
});
