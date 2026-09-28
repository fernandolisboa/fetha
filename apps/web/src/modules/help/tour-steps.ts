import type { DestinationHref } from "@/modules/shell/client";

import { t } from "./strings";

type TourStepId = keyof typeof t.tour.steps;

export interface TourTarget {
  selector: string;
  side: "bottom" | "right" | "top";
}

// Targets in order of preference: the first one on screen anchors the card,
// so a rail step points at the left rail on a wide screen and at the bottom
// tab bar under 768px, where the rail is hidden (#243).
export interface TourStep {
  id: TourStepId;
  targets: readonly TourTarget[];
}

const RAIL = '[data-tour="rail"]';
const TAB_BAR = '[data-tour="tab-bar"]';

function navigation(link = ""): readonly TourTarget[] {
  return [
    { selector: `${RAIL}${link}`, side: "right" },
    { selector: `${TAB_BAR}${link}`, side: "top" },
  ];
}

function destinationLink(href: DestinationHref): readonly TourTarget[] {
  return navigation(` a[href="${href}"]`);
}

export const tourSteps: readonly TourStep[] = [
  { id: "welcome", targets: [] },
  { id: "rail", targets: navigation() },
  { id: "commandSearch", targets: [{ selector: '[data-tour="command-search"]', side: "bottom" }] },
  { id: "addInstrument", targets: [{ selector: '[data-tour="add-instrument"]', side: "bottom" }] },
  { id: "signals", targets: destinationLink("/sinais") },
  { id: "strategies", targets: destinationLink("/estrategias") },
  { id: "portfolio", targets: destinationLink("/carteira") },
  { id: "journal", targets: destinationLink("/diario") },
  { id: "accountMenu", targets: [{ selector: '[data-tour="account-menu"]', side: "bottom" }] },
];
