export type OptionRightRaw = "call" | "put";

export type BsmInput = {
  s: number;
  k: number;
  t: number;
  r: number;
  q: number;
  sigma: number;
  right: OptionRightRaw;
};

export type GreeksRaw = {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
};

// ADR-0002: Black-Scholes-Merton with a continuous dividend yield, European for every
// series. The formulas need the standard normal CDF/PDF, which decimal.js has no closed
// form for; the Abramowitz & Stegun 7.1.26 approximation on plain doubles (error < 1.5e-7)
// is far below the 6-decimal-place scale every DecimalString reports at, so the seam
// converts to `number` here and callers convert back to Decimal at the boundary.
function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * absX);
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  const y = 1 - poly * Math.exp(-absX * absX);
  return 0.5 * (1 + sign * y);
}

function d1d2(input: Pick<BsmInput, "s" | "k" | "t" | "r" | "q" | "sigma">): {
  d1: number;
  d2: number;
} {
  const { s, k, t, r, q, sigma } = input;
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r - q + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return { d1, d2 };
}

function intrinsic(s: number, k: number, right: OptionRightRaw): number {
  return right === "call" ? Math.max(s - k, 0) : Math.max(k - s, 0);
}

export function bsmPriceRaw(input: BsmInput): number {
  const { s, k, t, r, q, sigma, right } = input;
  if (t <= 0 || sigma <= 0) return intrinsic(s, k, right);
  const { d1, d2 } = d1d2(input);
  const df = Math.exp(-r * t);
  const dq = Math.exp(-q * t);
  return right === "call"
    ? s * dq * normalCdf(d1) - k * df * normalCdf(d2)
    : k * df * normalCdf(-d2) - s * dq * normalCdf(-d1);
}

export function bsmGreeksRaw(input: BsmInput): GreeksRaw {
  const { s, k, t, r, q, sigma, right } = input;
  if (t <= 0 || sigma <= 0) {
    const inTheMoney = right === "call" ? s > k : s < k;
    return {
      delta: inTheMoney ? (right === "call" ? 1 : -1) : 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
    };
  }
  const { d1, d2 } = d1d2(input);
  const df = Math.exp(-r * t);
  const dq = Math.exp(-q * t);
  const pdfD1 = normalPdf(d1);
  const sqrtT = Math.sqrt(t);

  const delta = right === "call" ? dq * normalCdf(d1) : dq * (normalCdf(d1) - 1);
  const gamma = (dq * pdfD1) / (s * sigma * sqrtT);
  const vega = s * dq * pdfD1 * sqrtT;
  const theta =
    right === "call"
      ? -((s * dq * pdfD1 * sigma) / (2 * sqrtT)) -
        r * k * df * normalCdf(d2) +
        q * s * dq * normalCdf(d1)
      : -((s * dq * pdfD1 * sigma) / (2 * sqrtT)) +
        r * k * df * normalCdf(-d2) -
        q * s * dq * normalCdf(-d1);
  const rho = right === "call" ? k * t * df * normalCdf(d2) : -k * t * df * normalCdf(-d2);

  return { delta, gamma, theta, vega, rho };
}
