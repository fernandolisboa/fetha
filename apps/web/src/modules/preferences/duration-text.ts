import { t } from "./strings";
import { durationOf } from "./suggestion-archive";

const wholeNumber = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export function archiveDelayText(minutes: number): string {
  const { amount, unit } = durationOf(minutes);
  return t.suggestionArchive.duration[unit](wholeNumber.format(amount), amount === 1);
}
