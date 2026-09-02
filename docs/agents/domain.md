# Domain docs

Single bounded context. The domain truth lives in three places at the repo root:

- `CONTEXT.md` — what the system is, its modules (`auth`, `market-data`, `engine`, `strategies`,
  `portfolio`, `decisions`), the invariants and the key flows. Updated whenever a decision
  crystallizes, not after.
- `UBIQUITOUS_LANGUAGE.md` — the glossary. Every domain term used in code, tickets and UI copy
  has one entry with its canonical name, definition and rejected synonyms.
- `docs/adr/NNNN-title.md` — architecture decision records (context, decision, consequences,
  alternatives). Numbered, never edited after acceptance; superseded by a new ADR.

Skills that read the domain model (`grill-with-docs`, `tdd`, `to-issues`, `improve-codebase-architecture`)
start from these files. When code and docs disagree, the docs win and the code is a bug.
