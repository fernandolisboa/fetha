import { destinations, type Destination } from "@/modules/shell/client";

import { t } from "./strings";

export interface GuideSection extends Destination {
  summary: string;
  steps: string[];
}

export function guideSections(): GuideSection[] {
  return destinations().map((destination) => ({
    ...destination,
    ...t.guide.destinations[destination.href],
  }));
}
