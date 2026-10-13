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
  id: string;
  targets: readonly TourTarget[];
  title: string;
  body: string;
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

function step(id: TourStepId, targets: readonly TourTarget[]): TourStep {
  const copy = t.tour.steps[id];
  return { id, targets, title: copy.title, body: copy.body };
}

export const tourSteps: readonly TourStep[] = [
  step("welcome", []),
  step("rail", navigation()),
  step("commandSearch", [{ selector: '[data-tour="command-search"]', side: "bottom" }]),
  step("addInstrument", [{ selector: '[data-tour="add-instrument"]', side: "bottom" }]),
  step("signals", destinationLink("/sinais")),
  step("strategies", destinationLink("/estrategias")),
  step("portfolio", destinationLink("/carteira")),
  step("journal", destinationLink("/diario")),
  step("accountMenu", [{ selector: '[data-tour="account-menu"]', side: "bottom" }]),
];
