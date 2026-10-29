import assert from 'node:assert/strict';
import { nextOccurrenceDate, reminderOccurrences, isValidEventDate, isValidEventTime, getSeoulDate } from '../lib/recurrence.ts';

const rule = (eventDate, recurrence, recurrenceInterval = 1, recurrenceDay = null) => ({ eventDate, recurrence, recurrenceInterval, recurrenceDay });
assert.equal(nextOccurrenceDate(rule('2026-09-09', 'daily', 3), '2026-09-10'), '2026-09-12');
assert.equal(nextOccurrenceDate(rule('2026-09-09', 'weekly', 2, 1), '2026-09-09'), '2026-09-14');
assert.equal(nextOccurrenceDate(rule('2026-09-09', 'weekly', 2, 1), '2026-09-15'), '2026-09-28');
assert.equal(nextOccurrenceDate(rule('2026-01-31', 'monthly'), '2026-02-01'), '2026-02-28');
assert.equal(nextOccurrenceDate(rule('2026-01-31', 'monthly'), '2026-03-01'), '2026-03-31');
assert.equal(nextOccurrenceDate(rule('2026-09-20', 'monthly', 2, 5), '2026-09-01'), '2026-11-05');
assert.equal(nextOccurrenceDate(rule('2024-02-29', 'yearly'), '2025-01-01'), '2025-02-28');
assert.equal(nextOccurrenceDate(rule('2024-02-29', 'yearly'), '2028-01-01'), '2028-02-29');
assert.equal(nextOccurrenceDate(rule('2026-09-09', 'none'), '2026-09-10'), null);
assert.equal(getSeoulDate(new Date('2026-09-09T15:01:00Z')), '2026-09-10');
assert.equal(isValidEventDate('2026-02-29'), false);
assert.equal(isValidEventDate('2026-02-31'), false);
assert.equal(isValidEventTime('24:00'), false);
assert.equal(isValidEventTime('09:60'), false);
assert.equal(isValidEventTime('23:59'), true);
const window = [new Date('2026-09-09T23:55:00Z'), new Date('2026-09-10T00:05:00Z')];
for (const offset of [0, 10080, 525600]) {
  const occurrences = reminderOccurrences(rule('2020-01-01', 'daily'), '09:00', offset, ...window);
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].dueAt, '2026-09-10T00:00:00.000Z');
  assert.equal(Date.parse(occurrences[0].occurrenceAt) - Date.parse(occurrences[0].dueAt), offset * 60000);
}
const midnight = reminderOccurrences(rule('2026-09-10', 'none'), '00:00', 10,
  new Date('2026-09-09T14:45:00Z'), new Date('2026-09-09T14:55:00Z'));
assert.equal(midnight[0].dueAt, '2026-09-09T14:50:00.000Z');
assert.equal(reminderOccurrences(rule('2026-02-31', 'yearly'), '09:00', 0, ...window).length, 0);
console.log('PASS: daily/weekly/monthly/yearly recurrence, leap dates, Seoul midnight, long advance offsets, invalid input');
