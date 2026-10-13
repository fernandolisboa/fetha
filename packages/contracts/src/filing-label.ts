import { z } from "zod";

import { sessionDateSchema } from "./scalars";

export const filingTopics = [
  "results",
  "dividends",
  "guidance",
  "m_and_a",
  "debt",
  "litigation",
  "management",
  "buyback",
  "offering",
  "other",
] as const;
export type FilingTopic = (typeof filingTopics)[number];

// The tone for a shareholder of the company (docs/adr/0065).
export const filingTones = ["positive", "neutral", "negative"] as const;
export type FilingTone = (typeof filingTones)[number];

export const filingCategories = [
  "material_fact",
  "market_notice",
  "shareholder_notice",
  "shareholder_meeting",
] as const;
export type FilingCategory = (typeof filingCategories)[number];

const metadataText = (max: number) => z.string().trim().min(1).max(max);

// What the prompt states about the filing next to its document: the CVM
// file's own columns, never anything a user wrote.
export const filingLabelInputsSchema = z.strictObject({
  companyName: metadataText(200),
  category: z.enum(filingCategories),
  kind: metadataText(200).nullable(),
  subject: z.string().trim().max(1000),
  deliveredOn: sessionDateSchema,
});
export type FilingLabelInputs = z.infer<typeof filingLabelInputsSchema>;

// The model answers with words from closed lists and one sentence, never a
// number (docs/adr/0009, 0065).
export const filingLabelOutputSchema = z.strictObject({
  topic: z.enum(filingTopics),
  tone: z.enum(filingTones),
  summary: z.string().trim().min(1).max(280),
});
export type FilingLabelOutput = z.infer<typeof filingLabelOutputSchema>;

// Digits and the words Portuguese spells amounts with. "um"/"uma" are left
// out on purpose: they are also the indefinite article.
const SPELLED_FIGURE =
  /(?<!\p{L})(dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|duzentas|trezentos|trezentas|quatrocentos|quatrocentas|quinhentos|quinhentas|seiscentos|seiscentas|setecentos|setecentas|oitocentos|oitocentas|novecentos|novecentas|mil|milhão|milhões|bilhão|bilhões|trilhão|trilhões|metade|dobro|triplo)(?!\p{L})/iu;
const FIGURE_SIGN = /[\d%]/u;
// The exchange's own name is the one digit a plain summary needs ("em
// resposta à B3"); it is not a figure.
const EXCHANGE_NAME = /(?<![\p{L}\d])B3(?![\p{L}\d])/gu;

// The summary is shown as the app's own words: a web address or a handle a
// planted instruction slipped in must not reach the page as one.
const LINK_SIGN = /:\/\/|www\.|@|\.(?:com|br|net|org|io|info|app)(?![\p{L}\d])/iu;

export function summaryHoldsLink(summary: string): boolean {
  return LINK_SIGN.test(summary);
}

export function summaryHoldsFigure(summary: string): boolean {
  const text = summary.replace(EXCHANGE_NAME, "");
  return FIGURE_SIGN.test(text) || SPELLED_FIGURE.test(text);
}

export type FilingLabelCheck =
  { ok: true; label: FilingLabelOutput } | { ok: false; problem: "schema" | "figure" | "link" };

export function checkFilingLabel(reply: unknown): FilingLabelCheck {
  const parsed = filingLabelOutputSchema.safeParse(reply);
  if (!parsed.success) {
    return { ok: false, problem: "schema" };
  }
  if (summaryHoldsFigure(parsed.data.summary)) {
    return { ok: false, problem: "figure" };
  }
  if (summaryHoldsLink(parsed.data.summary)) {
    return { ok: false, problem: "link" };
  }
  return { ok: true, label: parsed.data };
}
