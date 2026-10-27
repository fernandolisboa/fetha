---
status: accepted
date: 2026-10-13
---

# Sentiment: filing labels, GDELT tone, a news-provider seam (#310, sharpens 0009, amends 0007, 0016, 0017, 0045, 0060)

## Context

#309 (ADR-0060) stores the filings listed companies deliver to the CVM, with a link to each
document. A list of subjects such as "Comunicado ao Mercado - Outros" tells a non-specialist little.
The epic #303 asks for sentiment on the asset page: what the company's recent filings mean for a
shareholder, and how the news is treating it. The owner wants nothing paid for now, but wants a
paid news source to be one key away.

What was checked on 2026-10-13, from this session's network:

- **RAD documents.** 33 real 2026 documents from 15 large companies (material facts, notices,
  meeting documents): median 2 pages, mean 6.5, largest 41. RAD serves every file as
  `text/html`, so only the bytes say whether it is a PDF. Without `Accept-Encoding: gzip`, the
  monitoring script RAD injects cuts the file short. A burst of downloads gets a ~4 KB HTML page
  in place of the file, so downloads spaced about 6 s apart get through.
- **GDELT DOC 2.0** (`api.gdeltproject.org/api/v2/doc/doc`) is free with attribution and asks
  for at most one request every 5 s. From shared egress IPs it often answers "Please limit
  requests…" or 429 even to a first request, so being rate limited is a normal outcome, not a
  failure.
- **Marketaux** (`/v1/news/all`) scores each entity it finds in an article from −1 to 1. Its free
  plan allows 100 requests a day and 3 articles a request, for personal, non-commercial use.
  No account was created; the adapter's fixture follows the documented response shape, with
  invented content.

## Decision

### Where it lives

A new `sentiment` module owns the four tables, the nightly step, the read model and the panel. It
reads `market-data` (filings, the ticker → CNPJ mapping), `watchlist` (which tickers to
follow) and, since the 2026-10-27 amendment, `radar` (its recent findings). The issue text placed the provider seam in `market-data`, but `market-data` cannot
depend on `watchlist` without a cycle. The seam serves only sentiment, so it lives here.

### Universe

The tickers on any user's watchlist (`watchedTickersOfAnyUser`, distinct tickers only, never who
watches them), grouped by company CNPJ. ETFs, real-estate funds and BDRs have no CNPJ mapping
(ADR-0060), so they get provider articles but no filings or GDELT tone. The radar widens the
universe (amendment 2026-10-27 below). Labels and tone are shared reference data. Seeing a label on an asset you
don't watch says someone in the instance watches it. That leak is accepted while the instance is
the owner's alone, and it disappears once the radar universe covers the whole market.

### Filing labels

- **Input.** Each filing in the universe delivered in the last 90 days, at its highest stored
  version, newest first. The PDF goes to the model as a document block. Alongside it goes the
  CVM row's own metadata (company name, category, kind, subject, delivery date), validated by
  `filingLabelInputsSchema` and serialized as JSON inside one `<filing_metadata>` block, with `<`,
  `>` and `&` escaped, so a planted tag cannot close the block. Nothing a user wrote goes in.
- **Contract** (`@fetha/contracts` `filing-label`). The reply must have exactly three fields.
  - `topic`, one of `results`, `dividends`, `guidance`, `m_and_a`, `debt`, `litigation`,
    `management`, `buyback`, `offering`, `other`.
  - `tone`, one of `positive`, `neutral`, `negative`, judged for a shareholder.
  - `summary`, one pt-BR sentence of at most 280 characters with no figure: no digit, no `%`,
    and no spelled-out amount (`dois`, `milhões`, `metade`, …). The one exception is the
    exchange's name, `B3`. The summary also may not hold a web address, an e-mail address or a
    handle. It is shown as the app's own words, so a lure planted in a filing must not reach the
    page.
  - Following ADR-0009, the model never produces a number. Prices, amounts and dates belong to
    the document, which the panel links.
  - ADR-0009 governs analyses: on demand, over engine artifacts. A filing label is a different
    use of AI. It is a closed-list classification of a public source document into shared
    reference data, with a bounded cost and a code switch. It is not an analysis, and ADR-0009's
    scope for analyses is unchanged.
- **Prompt.** `prompts/src/filing-label/v1.ts`, version `filing-label@1`, with a frozen digest
  test.
  - The system prompt says the document and its metadata are untrusted data, never instructions.
  - Golden fixtures cover a production report, interest on equity, a tax assessment and a
    meeting call.
  - Adversarial fixtures:
    - an instruction planted inside a filing, together with the reply that obeys it (rejected);
    - a numeric tone, a spelled-out figure, a web-address lure and an extra field (all rejected).
- **Call.**
  - Model: Claude Haiku 5.5, the cheapest current model.
  - `output_config.format` built from the Zod schema, effort `low`, `max_tokens` 2000.
  - No tools, a 60 s timeout and no SDK retries.
  - The reply is read by hand rather than with `parse()`, so that a refusal or a cut-off reply is
    recorded instead of thrown.
- **Outcomes** (`filing_labels`, one row per `(protocol, version)`, FK to `company_filings`).
  - `labelled`: the reply met the contract.
  - `rejected`: the reply broke the contract. The reason is `schema`, `figure`, `link`,
    `refusal`, `incomplete` or `bad_request` (the API refused the document itself).
  - `unreadable`: the file is not a PDF, is over 10 MB, or RAD would not hand it over on three
    nights.
  - `pending`: counts failed downloads. A failed download waits 20 h before the next attempt, so
    one bad day at RAD costs one attempt rather than all three crons' worth.
  - Labelled, rejected and unreadable are final and are never rewritten. A paid call is never
    repeated, and a prompt change re-labels nothing on its own.
  - Each row stores the model, the prompt version and the token counts of its call.
- **Failure modes.**
  - An API error (outage, refused key) stops the step and leaves the remaining filings for the
    next run untouched.
  - Downloads are spaced 6 s apart. A filing is only started if a download plus a model call
    (100 s) fits before the run's deadline.
  - At most 60 model calls a run, whatever the watchlists hold. A backlog drains over the
    following runs.
  - Nothing claims a filing before its call, so if the owner's manual run overlaps a cron run,
    both may pay for the same filing. The first final outcome wins and the second is dropped. At
    US$ 0.002 a filing that is accepted rather than locked against.
- **Switch.** #310 asked the owner to confirm the cost before labels call the model. He
  confirmed it on 2026-10-13, so `FILING_LABELS_SWITCHED_ON` in `modules/sentiment/settings.ts`
  ships `true`. Labels need that switch, `ANTHROPIC_API_KEY` (which ADR-0057 already uses) and
  the production deployment (`VERCEL_ENV=production`). The e2e suite runs the owner's manual
  ingestion on every PR preview, so a preview would otherwise pay to label the same filings on
  each run. Turning labels off is a one-line, reviewed change, not an env var.
- **Cost.**
  - Haiku 5.5 on the measured documents comes to about US$ 0.002 a filing (a 2-page PDF plus the
    prompt is roughly 2–4 k input tokens; the reply is under 100 output tokens).
  - The 15 measured companies deliver about 500 in-scope filings a year: about US$ 1 a year.
  - Labelling every listed company's filings would stay near US$ 25 a year.
  - The per-run cap bounds the worst case at 60 calls × 3 runs a day, about US$ 0.36 a day,
    even if a user adds every listed company to a watchlist.
  - The cost is charged to the instance's Anthropic key, outside ADR-0057's per-user analysis
    cap, because it is reference data and no user triggers it.

### News tone (GDELT, experimental)

- **Query.**
  - Per company: its trading name, or failing that its registered name without the legal
    suffix, OR up to four of its tickers, restricted to `sourcelang:portuguese`. For example,
    `("petrobras" OR petr3 OR petr4) sourcelang:portuguese`.
  - A common-word name ("vale") lets unrelated news in. The panel says so, and shows the query.
- **Data.**
  - Two requests per company: `timelinetone` and `timelinevolraw`, each over three months, as
    JSON.
  - The article count decides which days exist. A day with no articles is stored as tone 0 with
    0 articles. A day with articles but no tone point is left out rather than read as neutral.
  - Tone is stored as `numeric(8,4)`, parsed through `decimal.js`. A tone past ±100 or a
    non-integer count fails the company.
  - GDELT revises recent days, so a later fetch replaces a day.
- **Schedule.**
  - Requests are spaced 6 s apart.
  - A company is asked about again after 20 h, oldest first, so the three nightly crons share
    the list.
  - Being rate limited stops the step. It is recorded for that company, whose stored points stay
    as they were, and the company stays due for the next run. A failure is recorded too and the
    company waits for tomorrow. A database error on one company fails that company only.
  - An empty reply (`{}`) is stored as "no data". GDELT also sends `{}` while throttling, so the
    panel says GDELT returned no news, never that none exists.
- **Shown.**
  - The daily tone over 90 days, on a time axis. The line breaks on days without articles rather
    than joining distant days as if coverage were continuous.
  - The last 30 days' average weighted by articles. A day with one article must not move it as
    much as a day with fifty.
  - The query, the date of the last fetch, a note when the last attempt was rate limited or
    failed, and "Source: The GDELT Project".

### The news-provider seam

- `NewsSentimentProvider { name; latestArticles(tickers, now) }`. It returns the provider's
  articles, each with the provider's own score for that ticker, or `rate_limited` or `failed`.
- `newsSentimentProviderFromEnv` picks the adapter by which key is set. Today the only adapter is
  `MARKETAUX_API_TOKEN` → Marketaux. With no key there is no provider: the step reports `off`
  and the panel hides the section.
- **Marketaux.**
  - The request asks for `symbols=<TICKER>.SA`, entity-filtered, `pt,en`, the last 7 days, and 3
    articles.
  - An entity without a score is skipped, and only `https` links are accepted.
  - A `usage_limit_reached` or `rate_limit_reached` code, or a 429, reads as rate limited.
  - At most 30 requests a run (100 a day across three runs), one ticker per request, each ticker
    every 20 h.
- **Economatica** comes later as a second adapter, behind the same interface.
- Articles are insert-only in `news_articles (provider, article_id, ticker)`, with the score as
  `numeric(5,4)`.

### Schedule and budget

The sentiment step runs last in the nightly job (ADR-0017), after the analysis scoring and the
radar (ADR-0066), under the same deadline (start + 285 s). Labels, GDELT and the provider talk to three different hosts, so
they run side by side, each with its own spacing and per-item budget. One source failing is
reported next to the others and never thrown into the run. A failed source shows in the nightly
report and the owner's manual run (ADR-0045); rate limited and deferred do not, since the next run
picks them up.

### The panel

"Sentimento" on the asset page, below "Eventos recentes". It is experimental, and says that it is
updated nightly for the assets on a watchlist.

- **Filings.**
  - Counts by tone, and the five latest labels: date, topic chip, tone chip, and the one-line
    summary linking to the RAD document.
  - The filings still waiting to be read, and those that ended without a label. The tone counts
    then read against every filing in the window, not only the labelled ones.
  - An explainer saying an AI wrote the labels, writes no numbers and can be wrong.
- **News tone.** The chart, the 30-day average, the status notes and the attribution.
- **News with sentiment.** Shown only when a provider is configured or has articles stored: the
  five latest articles with the provider's score and attribution.

## Consequences

- Migration 0040 creates four shared reference tables (CLAUDE.md principle 5), written only by
  the nightly job and read by every user: `filing_labels`, `news_tone_points`,
  `sentiment_fetches` and `news_articles`. They hold no user data, so they need no isolation
  test and no LGPD export or deletion.
- One optional env var, `MARKETAUX_API_TOKEN`, set in Vercel only to switch on the paid seam. No
  new cron.
- ADR-0060 said filings carry only the subject and the link. This ADR downloads the document
  from the same CVM host to label it. The document is never stored, only the label.
- ADR-0007's sources gain GDELT, a public, free API, and Marketaux as an optional per-instance
  adapter. Neither is scraped.
- Whether labels or news tone enter the facts of an AI analysis (ADR-0057) is left to a later ADR.
- GDELT may answer rate limited from Vercel's egress as it does from this session's. The panel
  then says so and the company stays due. If it never succeeds from Vercel, the fallback is
  fewer companies per run, not another source.

## Amendment (2026-10-16, ADR-0068)

The filing-label job now resolves `claude-haiku-5-5`'s family to its newest release instead of
sending that literal id, keeping the server key only; a 400/404 on the resolved id retries once on
the pinned id before the filing is marked `bad_request`. See docs/adr/0068.

## Amendment (2026-10-27, ADR-0076)

The question left open above is decided: filing labels, news tone and the provider's articles enter
the facts of an AI research (not of a single-object analysis), cut at the newest close. See
docs/adr/0076.

## Amendment (2026-10-27, #360, ADR-0076)

**Universe.** The universe is the union of the watchlist tickers, listed first, and the underlyings
with radar findings (`radar_matches`) in the last `RESEARCH_WINDOW_SESSIONS` (5) read sessions,
the same window "Obter sugestões" researches (ADR-0075), newest session first. Within a session
the names found in more of the window's sessions come first, then ticker order, so a cap that
cuts a session does not always cut the same alphabetical tail. At most
`RADAR_SENTIMENT_TICKERS` (40) underlyings are added on top of the watchlist; a ticker already on
a watchlist and a market index (ADR-0062) take no slot. Tickers stay distinct, never tied to who
watches them, and companies are grouped by CNPJ as before, in the same order as `tickers`. The
radar exposes the read as `recentFindingUnderlyings` through its index; radar does not import
sentiment.

**Order.** The nightly job scans the radar before the sentiment step, so the night's own findings
are in the window. The universe carries which tickers and companies are watched, and each job
keeps them ahead of the radar names under its cap and deadline: GDELT tone and provider articles
sort what is due watched first, then oldest fetch first (a never-fetched radar name cannot jump
a watched one fetched yesterday); filing labels sort the filings to label watched companies first,
then newest delivered first. A short run, or the provider's 30-request cap, therefore serves the
watchlist before any radar name.

**Leak note.** Seeing a label on an asset you don't watch used to say someone in the instance
watches it. It now also covers "the radar found it", which is shared reference data anyway, so
the note shrinks to the watchlist-only part and loses weight as the radar covers more.

**Cost.** Filing labels run on the server key (owner agreed 2026-10-16). Cost stays under the
existing 60-calls-per-run label cap; the 40-name cap bounds how many new companies enter per night
(the rotating radar set grows the labelled set over time). The first night after this deploys
labels up to 90 days of filings for the newly covered companies, resumable under the existing
per-item budget and deferral. Marketaux stays optional, off unless its token is set, and keeps its
own rate-limit status.

ADR-0076's research facts therefore usually exist for radar ideas now.
