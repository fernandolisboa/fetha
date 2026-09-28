import { t } from "./strings";

type TourStepId = keyof typeof t.tour.steps;

export interface TourStep {
  id: TourStepId;
  target: string | null;
  side: "bottom" | "right";
}

export const tourSteps: readonly TourStep[] = [
  { id: "welcome", target: null, side: "bottom" },
  { id: "rail", target: '[data-tour="rail"]', side: "right" },
  { id: "addInstrument", target: '[data-tour="add-instrument"]', side: "bottom" },
  { id: "strategies", target: '[data-tour="rail"] a[href="/estrategias"]', side: "right" },
  { id: "signals", target: '[data-tour="rail"] a[href="/sinais"]', side: "right" },
  { id: "portfolio", target: '[data-tour="rail"] a[href="/carteira"]', side: "right" },
  { id: "journal", target: '[data-tour="rail"] a[href="/diario"]', side: "right" },
  { id: "accountMenu", target: '[data-tour="account-menu"]', side: "bottom" },
];
