import type { Centavos, CostModel, DecimalString, RiskProfile } from "@fetha/contracts";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function centavos(value: number): Centavos {
  return value as Centavos;
}

// The B3 defaults ADR-0004 names: emolument on the gross traded value (B3's
// published Tarifa de Negociação), zero stock brokerage, a per-contract
// option brokerage, a small option slippage, the simplified 15% monthly
// income tax and the R$ 20.000 monthly stock-sales exemption (ADR-0004,
// income-tax law 11.033/2004 art. 3 II). A run's cost model input (the
// ticket's "cost model" acceptance criterion) starts from a preset the
// create-run form lets the owner pick between (see COST_MODEL_PRESETS);
// nothing in v1 lets the owner edit a preset's individual fields further.
export const DEFAULT_COST_MODEL: CostModel = {
  b3FeeRate: decimalString("0.0005"),
  brokerage: { stockPerOrder: centavos(0), optionPerContract: centavos(99) },
  optionSlippageRate: decimalString("0.001"),
  incomeTaxRate: decimalString("0.15"),
  monthlyStockSalesExemption: centavos(20_000_00),
};

// A second preset, distinct only in brokerage: a discount broker charging
// per stock order instead of B3's zero-brokerage default, so the form has
// at least one real alternative (the ticket's "cost model" acceptance
// criterion; the B3 fee itself does not vary by broker).
export const DISCOUNT_BROKER_COST_MODEL: CostModel = {
  ...DEFAULT_COST_MODEL,
  brokerage: { stockPerOrder: centavos(490), optionPerContract: centavos(99) },
};

export const COST_MODEL_PRESETS = {
  b3_default: DEFAULT_COST_MODEL,
  discount_broker: DISCOUNT_BROKER_COST_MODEL,
} as const;

export type CostModelPresetId = keyof typeof COST_MODEL_PRESETS;
export const costModelPresetIds = Object.keys(COST_MODEL_PRESETS) as CostModelPresetId[];

// Test fixture only: production run creation (actions.ts) takes the run's
// RiskProfile from the user's own declaration in `portfolio`
// (`getCurrentRiskProfile()`) and refuses to create a run when none is
// declared, rather than fabricating an unconstrained one that would make
// the "Enforce / Warn only" control unable to change any outcome.
export function defaultRiskProfile(declaredCapital: Centavos): RiskProfile {
  return {
    declaredCapital,
    limits: {
      maxLossPerOperation: decimalString("1"),
      maxExposurePerOperation: decimalString("1"),
      maxOpenOperations: 50,
      maxPremiumBought: decimalString("1"),
    },
  };
}
