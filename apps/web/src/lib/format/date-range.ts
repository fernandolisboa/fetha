import { formatDate, formatDateTime, formatTime } from "./date-time";

export function formatDateRange(first: Date, last: Date): string {
  if (formatDate(first) === formatDate(last)) {
    return `${formatDate(last)} ${formatTime(first)} – ${formatTime(last)}`;
  }
  return `${formatDateTime(first)} – ${formatDateTime(last)}`;
}
