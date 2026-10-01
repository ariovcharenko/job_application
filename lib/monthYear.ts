/** "YYYY-MM" <-> separate month/year, for the graduation dropdowns. Month is 1-12. */

export interface MonthYear {
  month: number | null;
  year: number | null;
}

export function parseMonthYear(value: string): MonthYear {
  const m = value.match(/^(\d{4})-(\d{2})$/);
  if (!m) return { month: null, year: null };
  const month = Number(m[2]);
  return { month: month >= 1 && month <= 12 ? month : null, year: Number(m[1]) };
}

/** Returns "" until both parts are chosen, so a half-filled date is never saved. */
export function formatMonthYear({ month, year }: MonthYear): string {
  return month && year ? `${year}-${String(month).padStart(2, "0")}` : "";
}

/** Years to offer in the dropdown, always including `current` (so an old saved year is not lost). */
export function yearChoices(now: Date = new Date(), current: number | null = null): number[] {
  const y = now.getFullYear();
  const years: number[] = [];
  for (let i = y - 2; i <= y + 8; i++) years.push(i);
  if (current !== null && !years.includes(current)) years.push(current);
  return years.sort((a, b) => a - b);
}
