import type { DestinationHref } from "@/modules/shell/client";

import { t } from "./strings";

type TourStepId = keyof typeof t.tour.steps;

export interface TourStep {
  id: TourStepId;
  target: string | null;
  side: "bottom" | "right";
}

function railLink(href: DestinationHref): string {
  return `[data-tour="rail"] a[href="${href}"]`;
}

export const tourSteps: readonly TourStep[] = [
  { id: "welcome", target: null, side: "bottom" },
  { id: "rail", target: '[data-tour="rail"]', side: "right" },
  { id: "commandSearch", target: '[data-tour="command-search"]', side: "bottom" },
  { id: "addInstrument", target: '[data-tour="add-instrument"]', side: "bottom" },
  { id: "signals", target: railLink("/sinais"), side: "right" },
  { id: "strategies", target: railLink("/estrategias"), side: "right" },
  { id: "portfolio", target: railLink("/carteira"), side: "right" },
  { id: "journal", target: railLink("/diario"), side: "right" },
  { id: "accountMenu", target: '[data-tour="account-menu"]', side: "bottom" },
];
