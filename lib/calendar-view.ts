/** Date-only helpers: the calendar uses Korean dates, never the browser's timezone. */
export function shiftCalendarMonth(month: string, offset: number) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function getMonthDays(month: string) {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const length = Math.max(35, Math.ceil((offset + last) / 7) * 7);
  return Array.from({ length }, (_, index) =>
    new Date(Date.UTC(year, number - 1, index - offset + 1)).toISOString().slice(0, 10),
  );
}

export function calendarDateLabel(date: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`));
}
