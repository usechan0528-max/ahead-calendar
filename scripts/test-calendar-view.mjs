import assert from 'node:assert/strict';
import { getMonthDays, shiftCalendarMonth, calendarDateLabel } from '../lib/calendar-view.ts';
import { nextOccurrenceDate } from '../lib/recurrence.ts';

assert.equal(shiftCalendarMonth('2026-12', 1), '2027-01');
assert.equal(shiftCalendarMonth('2026-01', -1), '2025-12');
for (const month of ['2026-02', '2026-03', '2026-09', '2028-02', '2027-08']) {
  const days = getMonthDays(month);
  assert.equal(days.length % 7, 0);
  assert.ok(days.length >= 35 && days.length <= 42);
  assert.equal(new Date(`${days[0]}T00:00:00Z`).getUTCDay(), 1);
  assert.equal(new Date(`${days.at(-1)}T00:00:00Z`).getUTCDay(), 0);
  assert.equal(new Set(days).size, days.length);
  assert.equal(days.filter((day) => day.startsWith(month)).length, new Date(`${shiftCalendarMonth(month, 1)}-01T00:00:00Z`).getTime() / 86400000 - new Date(`${month}-01T00:00:00Z`).getTime() / 86400000);
}
assert.ok(calendarDateLabel('2026-09-09').includes('9월 9일'));
const rule = (eventDate, recurrence, recurrenceInterval = 1, recurrenceDay = null) => ({ eventDate, recurrence, recurrenceInterval, recurrenceDay });
const shown = (item, month) => getMonthDays(month).filter((date) => date.startsWith(month) && nextOccurrenceDate(item, date) === date);
assert.equal(shown(rule('2026-09-01', 'daily'), '2026-09').length, 30);
assert.deepEqual(shown(rule('2026-09-09', 'weekly', 2, 1), '2026-09'), ['2026-09-14', '2026-09-28']);
assert.deepEqual(shown(rule('2026-01-31', 'monthly'), '2026-02'), ['2026-02-28']);
assert.deepEqual(shown(rule('2024-02-29', 'yearly'), '2028-02'), ['2028-02-29']);
assert.deepEqual(shown(rule('2026-09-09', 'none'), '2026-09'), ['2026-09-09']);
assert.deepEqual(shown(rule('2026-09-09', 'none'), '2026-10'), []);
assert.deepEqual(shown(rule('2026-09-20', 'monthly', 2, 5), '2026-09'), []);
assert.deepEqual(shown(rule('2026-09-20', 'monthly', 2, 5), '2026-11'), ['2026-11-05']);
console.log('Calendar month boundaries, date labels and recurring date display passed.');
