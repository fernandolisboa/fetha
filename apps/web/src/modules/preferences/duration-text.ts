import { t } from "./strings";
import { durationOf } from "./suggestion-archive";

const wholeNumber = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

// "1 dia", "12 horas", "1.440 minutos": the delay in the largest unit that divides it exactly.
export function archiveDelayText(minutes: number): string {
  const { amount, unit } = durationOf(minutes);
  return t.suggestionArchive.duration[unit](wholeNumber.format(amount), amount === 1);
}
