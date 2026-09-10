import type { Centavos, CostModel, DecimalString, RiskProfile } from "@fetha/contracts";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function centavos(value: number): Centavos {
  return value as Centavos;
}

// The B3 defaults ADR-0004 names: emolument on the gross traded value, zero
// stock brokerage, a per-contract option brokerage, a small option
// slippage, the simplified 15% monthly income tax and the R$ 20.000
// monthly stock-sales exemption. A run's cost model input (the ticket's
// "cost model" acceptance criterion) starts from this preset; nothing in
// v1 lets the owner edit it further, tracked as a follow-up rather than
// this ticket's scope.
export const DEFAULT_COST_MODEL: CostModel = {
  b3FeeRate: decimalString("0.0005"),
  brokerage: { stockPerOrder: centavos(0), optionPerContract: centavos(99) },
  optionSlippageRate: decimalString("0.001"),
  incomeTaxRate: decimalString("0.15"),
  monthlyStockSalesExemption: centavos(2_000_000_00),
};

// Effectively unconstrained per-operation limits (leftOpenUnitIntervalSchema
// tops out at "1" = 100%) plus a generous open-operations ceiling: a
// backtest run declares its own capital as declaredCapital, and its risk
// limits only start mattering once the owner tightens them, tracked the
// same way as the cost model above.
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
