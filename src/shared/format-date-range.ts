const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Formats ISO dates as "Jan 2025 – Present". A null end means ongoing. */
export function formatDateRange(start: string, end: string | null): string {
  const from = MONTH_YEAR.format(new Date(start));
  const to = end === null ? "Present" : MONTH_YEAR.format(new Date(end));
  return `${from} – ${to}`;
}
