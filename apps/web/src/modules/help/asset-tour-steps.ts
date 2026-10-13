import { t } from "./strings";

import type { TourStep } from "./tour-steps";

// The asset page's own 3-step tour (ADR-0046 addendum, #304): same
// machinery as the main tour, its own steps and its own targets, set by the
// asset page itself.
export const assetTourSteps: readonly TourStep[] = [
  {
    id: "assetReading",
    targets: [{ selector: '[data-tour="asset-reading"]', side: "right" }],
    title: t.assetTour.steps.assetReading.title,
    body: t.assetTour.steps.assetReading.body,
  },
  {
    id: "assetNextSteps",
    targets: [{ selector: '[data-tour="asset-next-steps"]', side: "right" }],
    title: t.assetTour.steps.assetNextSteps.title,
    body: t.assetTour.steps.assetNextSteps.body,
  },
  {
    id: "assetChart",
    targets: [{ selector: '[data-tour="asset-chart"]', side: "bottom" }],
    title: t.assetTour.steps.assetChart.title,
    body: t.assetTour.steps.assetChart.body,
  },
];
