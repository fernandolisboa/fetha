import { MIN_SESSIONS_TO_EXPIRY, dropReasons, type DropReason } from "./research-rules";
import { t } from "./strings";

export function researchSummary(input: {
  candidates: number;
  sessionsLooked: number;
  dropped: Record<DropReason, number>;
}): string {
  const strings = t.research;
  const looked = strings.summary(input.candidates, input.sessionsLooked);
  const total = dropReasons.reduce((sum, reason) => sum + input.dropped[reason], 0);
  if (total === 0) return `${looked}.`;

  const reasons = dropReasons.flatMap((reason) => {
    const count = input.dropped[reason];
    if (count === 0) return [];
    return [
      reason === "expires_too_soon"
        ? strings.dropped.expires_too_soon(count, MIN_SESSIONS_TO_EXPIRY)
        : strings.dropped[reason](count),
    ];
  });
  return `${looked}${strings.droppedTotal(total)}${reasons.join(", ")}.`;
}
