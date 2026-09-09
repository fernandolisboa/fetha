---
status: accepted
date: 2026-09-02
---

# Decisions and analyses are scored at their horizon on outcome, thesis accuracy and counterfactual

Every decision (enter, do not enter, hold, adjust, exit) and every AI analysis is scored once
its horizon passes (the thesis date or the operation's expiry). Three components: realized P&L
normalized by the operation's max loss, so decisions of different sizes compare; whether the
thesis held, crossed with the confidence stated at the time (Brier-style calibration); and, for
"do not enter", the counterfactual P&L of the operation not taken, computed with the backtest
fill model. Scoring is computed by the engine from stored inputs and market data, never edited
by hand, so the journal is an honest track record for the user and a calibration check for the
AI. Decisions, analyses and their scores are append-only.

## Considered options

- Raw P&L only: hides luck versus judgment and cannot score "do not enter".
- Letting the user grade their own decisions: defeats the purpose.
