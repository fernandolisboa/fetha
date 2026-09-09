---
status: accepted
date: 2026-09-02
---

# AI analyses are on demand, per object, over engine artifacts only, with a fixed output contract

An analysis is requested by the user for one object (a signal, an operation being built or held,
or a strategy version with its backtest run); it never runs in batch. The app assembles only the
engine artifacts for that object (payoff table, greeks, break-evens, max loss, backtest metrics,
risk-profile check, current macro rates), sends them with a versioned prompt from `prompts/`, and
validates the reply against a Zod schema before storing it: thesis, counter-thesis, key risks,
max loss, break-evens, invalidation conditions and confidence with justification, each citing
the inputs used. The model never produces a number that is not in its inputs; any figure in the
output must match an input or the analysis is rejected. Opus handles thesis/counter-thesis and
strategy critique; Sonnet handles routine reports. Each user has a monthly cap (default 50) to
bound cost. Analyses are append-only and scored like decisions.

## Considered options

- Automatic analysis of every signal: convenient, but unbounded cost and a stream of unread
  opinions; the user asks when they are about to decide.
- Letting the model compute (for example, its own break-evens): rejected by principle; the
  engine is the only source of numbers.
