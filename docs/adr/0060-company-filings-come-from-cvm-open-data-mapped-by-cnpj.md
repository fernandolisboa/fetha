---
status: accepted
date: 2026-10-13
---

# Company filings come from CVM open data, mapped to tickers by CNPJ (#309, amends 0007, 0017)

## Context

The asset page shows prices and nothing about the company behind them. The first free, licensed
source for "what is happening with this company" is the filings listed companies must deliver to
the CVM: material facts, market notices, shareholder notices and meeting documents. The CVM
publishes them as open data under the Open Database License (ODbL), as yearly CSV files that
link each filing to its document on CVM's own RAD system. ADR-0007 lists B3 and Bacen as the
reference backbone; this adds a third public publisher. ADR-0017 lists the nightly sources; this
adds one more.

Checked on 2026-10-13: `ipe_cia_aberta_2026.zip` is 1.7 MB (15 MB of latin1 CSV, 36,582 rows
delivered up to 2026-10-08), regenerated on 2026-10-11, so the file lags delivery by a few days.

## Decision

**Source.** "Cias Abertas: Documentos: Periódicos e Eventuais (IPE)",
`https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS/ipe_cia_aberta_<year>.zip`, read by
`adapters/cvm` with a Zod schema per row. Four categories are kept: Fato Relevante
(`material_fact`), Comunicado ao Mercado (`market_notice`), Aviso aos Acionistas
(`shareholder_notice`) and Assembleia (`shareholder_meeting`), the last limited to the call notice,
the board's proposal and the minutes (a meeting otherwise files ballots, voting maps and manuals
that say nothing new). Every other category is dropped.

**Natural key.** `company_filings (protocol, version)`. The file holds only the newest version of
each protocol (3,417 rows of 2026 are re-presentations), so an older version may already be stored
when a newer one arrives; readers keep each protocol's highest stored version. A stored
`(protocol, version)` is never rewritten: inserts are `ON CONFLICT DO NOTHING`. Exact duplicate
rows exist in the file and are collapsed by the parser.

**Ticker mapping.** The IPE file carries the company's CNPJ, not its trading codes. The CVM's
FCA dataset (`fca_cia_aberta_<year>.zip`, entry `fca_cia_aberta_valor_mobiliario_<year>.csv`)
lists each company's securities with `Codigo_Negociacao`. That field is free text ("NÃO HÁ",
"N/A", "tgma3"), so it is upper-cased and kept only for shares, units and deposit certificates
whose code looks like a B3 share code (`^[A-Z0-9]{4}\d{1,2}$`). `company_tickers (ticker)` maps
the code to its CNPJ; a code listed under two CNPJs keeps the newest `Data_Referencia`. Both this
and last year's FCA are read, because a company files the new year's form during the first months.
Foreign issuers without a Brazilian CNPJ share the placeholder `00.000.000/0000-00`, which would
merge all of them; rows with it are dropped from both files. ETFs, real-estate funds and BDRs have
no FCA, so they are never mapped, and the panel says so instead of "nothing recent".

**Cadence.** A new ingestion source, `cvm_filings`, session-bound like the others (ADR-0017): it
runs for each un-succeeded session in the recent window. The files are cumulative, so the first
session an invocation attempts downloads them and every other gap shares that outcome. It reads
the current year's IPE file, plus the previous year's until the end of March, when the current
file is still too short to fill the panel. Only rows delivered within 30 days of the newest
stored filing are sent to the database (all of them on the first run), which covers the file's
regeneration lag and re-presentations without re-sending the whole year every night. A 404 for
the current year's IPE file (its first days) is `pending`, not a failure; no FCA file for either
year is a failure. The files are fetched in parallel with a 30 s timeout each. The source runs
after tonight's iv_index session and before the iv_index backfill, under the backfill's 40% start
budget (ADR-0054), so it never delays what tonight's evaluation reads. Like iv_index it stays out
of `ingest().ok`: nothing downstream reads filings, so a CVM outage must not turn the cron red.
Its failure still shows in the nightly report and the owner's manual run (ADR-0045).

**Freshness.** The panel states the newest delivery date across all stored filings ("Dados da CVM
até 08/10/2026", today and yesterday phrased like the market bar), which is the file's own cutoff,
not when the job last ran.

**Safety.** The document link is rendered as an anchor, so the schema accepts only `https` URLs on
`www.rad.cvm.gov.br`; the link opens in a new tab with `noopener noreferrer`. Download and
inflated sizes are bounded (32 MB zip, 256 MB entry), an order of magnitude above today's files.
More than 20 malformed in-scope rows fail the whole file rather than landing part of it.

**Attribution.** ODbL requires it: the panel names the CVM's open data and the license.

## Consequences

- Two shared reference tables, read-only to users (CLAUDE.md principle 5): `company_filings` and
  `company_tickers`, migration 0036. No user-scoped table, so no isolation test.
- No new cron and no environment variable: the source rides the existing nightly ingestion.
- Filings are the input #310 (sentiment) labels; they carry the subject and the document link
  only, not the document's text.
- A company that changes CNPJ (a merger) keeps its old filings under the old CNPJ; the panel
  shows the new company's from the day the FCA maps the code to it.
