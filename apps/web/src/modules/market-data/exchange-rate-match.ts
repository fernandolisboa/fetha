import { exchangeRatePairValues, type ExchangeRatePair } from "./adapters/bacen-sgs/schema";

export interface ExchangeRateSearchHit {
  pair: ExchangeRatePair;
}

// Accent-insensitive aliases a user typed to find a pair, lowercased, no
// diacritics (docs/adr/0059): matched the same way the pair code itself is,
// by prefix, so "dol" already finds USDBRL.
const EXCHANGE_RATE_ALIASES: Record<ExchangeRatePair, string[]> = {
  USDBRL: ["dolar"],
  EURBRL: ["euro"],
};

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalize(value: string): string {
  return stripDiacritics(value).toLowerCase().trim();
}

export function exchangeRateHref(pair: ExchangeRatePair): string {
  return `/cambio/${pair}`;
}

// Pure and client-safe (no server action, no DB query, #305): the universe
// is two static pairs, so matching a typed query is a prefix check over the
// pair code and its aliases, both accent- and case-insensitive. Returns the
// pair only; the one label shown for it (search result, page chip) comes
// from the module strings (`t.exchangeRate.pairLabel`), not from here.
export function matchExchangeRates(query: string): ExchangeRateSearchHit[] {
  const needle = normalize(query);
  if (needle === "") {
    return [];
  }
  return exchangeRatePairValues
    .filter((pair) => {
      if (normalize(pair).startsWith(needle)) {
        return true;
      }
      return EXCHANGE_RATE_ALIASES[pair].some((alias) => alias.startsWith(needle));
    })
    .map((pair) => ({ pair }));
}
