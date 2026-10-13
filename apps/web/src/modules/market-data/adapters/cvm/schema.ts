import { sessionDateSchema, tickerSchema } from "@fetha/contracts";
import { z } from "zod";

import { companyFilingCategoryValues } from "../../schema";

export const companyFilingCategorySchema = z.enum(companyFilingCategoryValues);

export const cnpjSchema = z.string().regex(/^\d{14}$/);

// The document link is rendered as an anchor on the asset page, so it is
// pinned to CVM's own RAD host over https: a malformed or tampered file can
// never turn it into a `javascript:` or third-party link (docs/adr/0060).
export const radDocumentUrlSchema = z.url({
  protocol: /^https$/,
  hostname: /^www\.rad\.cvm\.gov\.br$/,
});

export const companyFilingSchema = z.object({
  protocol: z.string().regex(/^[0-9A-Z-]{1,40}$/),
  version: z.number().int().positive(),
  cnpj: cnpjSchema,
  companyName: z.string().min(1).max(200),
  category: companyFilingCategorySchema,
  kind: z.string().min(1).max(500).nullable(),
  subject: z.string().max(10_000),
  deliveredOn: sessionDateSchema,
  documentUrl: radDocumentUrlSchema,
});
export type CompanyFiling = z.infer<typeof companyFilingSchema>;

export const companyTickerSchema = z.object({
  ticker: tickerSchema.regex(/^[A-Z0-9]{4}\d{1,2}$/),
  cnpj: cnpjSchema,
  referenceDate: sessionDateSchema,
});
export type CompanyTicker = z.infer<typeof companyTickerSchema>;
