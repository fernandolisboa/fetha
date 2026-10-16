---
status: accepted
date: 2026-10-16
---

# Per-user model family, auto-resolved to the newest release, and an optional own Anthropic key (#322, amends 0009, 0057, 0065)

## Context

ADR-0009 and ADR-0057 pin an analysis to a literal model id per subject kind (`claude-opus-5-5`,
`claude-sonnet-5-5`); ADR-0065 pins the filing-label job to `claude-haiku-5-5`. Every one of those
ids is frozen in `@fetha/prompts`, so a new Anthropic release (a `claude-opus-6`, say) needs a code
change and a deploy before any analysis can use it. The owner asked on 2026-10-16 for the model
used by analyses to be configurable per user, in Configurações, limited to the Haiku, Sonnet and
Opus families, with the user's own Anthropic key there too — and for a new release of a family to
be picked up without an app change.

## Decision

1. **A family, not a pinned id.** `@fetha/contracts` gets `ModelFamily = "haiku" | "sonnet" |
"opus"`. `@fetha/prompts` keeps `pinnedModels: Record<ModelFamily, string>` (the 5.5-generation
   id of each family, today's floor and fallback) and replaces `analysisModels` with
   `defaultAnalysisFamilies: Record<AnalysisSubjectKind, ModelFamily>` — the same split ADR-0009
   set (Opus for both operation kinds and a backtest run, Sonnet for a signal) — and
   `filingLabelModel` with `filingLabelFamily: "haiku"`. Prompt text is unchanged; no prompt
   digest moves.
2. **Resolved to the newest release at call time.** `apps/web`'s new `ai-models` module adds
   `newestOfFamily`: given a model listing and a family, it parses ids matching
   `claude-(haiku|sonnet|opus)-(\d+)(-\d{1,2})?(-\d{8})?`, picks the highest (major, minor),
   tiebreaking on a newer `created_at` and then the undated alias, and never returns anything
   older than that family's pinned id — an empty or unparseable listing (Fable, Mythos, anything
   outside the three families) answers the pin. `ModelCatalog` lists `models.list()` (the SDK,
   auto-paginating) for a given API key, keyed by that key, cached 6h after a success and 10min
   after a failure (a failure resolves to the pin); `resolveModel(family, listingKey)` answers the
   pin outright when no key is given.
3. **Per-user family choice, stored, not derived from the job.** New user-scoped table
   `ai_settings` (`user_id` unique, cascade on delete): `model_families` (a partial
   `Record<AnalysisSubjectKind, ModelFamily>`, Zod-validated at read and write — absent means the
   kind's own default) and the key fields below. A `/configuracoes` row per subject kind offers
   Default/Haiku/Sonnet/Opus and shows the resolved version in prose ("usando Claude Opus 5.5").
4. **An own Anthropic key, encrypted.** `api_key_ciphertext`, `api_key_last4`,
   `api_key_updated_at`. AES-256-GCM, a 12-byte random IV, the key derived from
   `BETTER_AUTH_SECRET` by HKDF-SHA256 with a fixed salt and info string (never the raw secret),
   AAD the user's id. Saving validates the key with a live, one-page Models API call first (401/403
   → rejected as invalid, anything else → rejected as unreachable); nothing is written on a
   rejection. A decrypt failure (the secret rotated, a tampered row) reads as `unreadable`; an
   analysis request then answers its own `own_key_unreadable` outcome rather than silently billing
   the server key, so the user is told to re-save or remove it instead of having it quietly ignored.
   The invariant actually enforced: the plaintext is never returned to a page, a client component
   or a data export — no query or export returns more than
   `{ configured, last4, updatedAt, readable }` — and it is used only server-side, inside a server
   action or server function, for an analysis request, the "test this key" button and resolving the
   model listing.
5. **Which key, which listing.** An analysis request bills the user's own key when it is stored
   and still decrypts; a stored key that no longer decrypts answers `own_key_unreadable` instead of
   falling back; with no own key at all it bills the server's key, or answers `unavailable` with
   neither. `isAnalysisAvailable` is true whenever either key would bill. The model listing itself
   prefers the server's key when one is configured, else the requesting user's own key (only
   decrypted when there is no server key to list with) — so the shared catalog cache serves every
   user from one listing call instead of each own key paying for its own. The nightly filing-label
   job keeps the server key only, as ADR-0065 set, now resolving `filingLabelFamily` instead of a
   pinned id.
6. **One retry on the pinned id for a bad resolution.** A resolved id can go stale (a dated
   snapshot Anthropic later removes, a release withdrawn): `createAnthropicAnalysisClient` and
   `createAnthropicFilingLabelClient` retry once, on the family's own pinned id, on a 400 or 404
   from the first attempt, and report the pinned attempt's own outcome (so a filing's bad PDF still
   ends `bad_request`, now after one wasted retry, not none). `fallbacks: "default"` and its beta
   are sent only for sonnet and opus; Haiku 5.5 has no server-side fallback, so the beta is omitted
   for that family rather than sent and rejected.
7. **Caps and cost model unchanged.** The 50/month and 3/minute caps (ADR-0057) apply the same way
   whichever key answers; `saveAnthropicApiKeyAction` and `testAnthropicApiKeyAction` get their own
   5-per-minute account rate limit, the same shape as the analysis request's own.

## Consequences

- Rotating `BETTER_AUTH_SECRET` makes every stored own key unreadable at once; the owner accepted
  this on 2026-10-16 as the cost of deriving the encryption key from a secret already rotated
  under a documented procedure, rather than minting and storing a second secret just for this.
- A user who never opens the new settings section sees no behavior change: the default family per
  kind and the server key answer exactly as ADR-0009/0057/0065 set, except that the resolved id can
  now be newer than the pin without a deploy.
- The Models API call that lists models is a new kind of outbound call (previously only
  `messages.create`): it carries no request content, only the key, and times out at 5s with no
  retries so a slow or down listing endpoint degrades to the pin instead of stalling an analysis.
- `ai-models` is a new deep module `decisions` and `sentiment` both depend on for model resolution
  and the server key reader (moved out of `decisions/analysis-model.ts`); neither depends on the
  other.
- The privacy policy's "what you enter" paragraph and the Anthropic processing paragraph both gain
  a sentence about the optional own key; terms version `2026-10-16.1`.

## Considered options

- Keep pinning literal ids, bump them by hand on release: exactly the toil the owner asked to
  remove, and the one this ADR replaces.
- Resolve the newest release once at deploy time, cache it in an env var: still needs a deploy (or
  at least a redeploy trigger) per release; the per-request resolver with a short TTL gets the same
  effect without one.
- Let the user type a literal model id instead of picking a family: reopens the "any Anthropic
  model, including ones never tested against this prompt contract" risk the family list was meant
  to close.
- Store the own key in plaintext, relying on database access control alone: fails LGPD data
  minimization for a credential that bills a third party directly; encrypted at rest with a
  scoped decrypt path is the same bar the rest of the app's secrets meet.
