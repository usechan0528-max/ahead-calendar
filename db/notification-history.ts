/** Retry budget can reset on snooze; delivery identity and replay protection cannot. */
export function attemptHistorySql(job = 'notification_jobs') {
  const postponed = `${job}.kind = 'reminder' AND unixepoch(${job}.scheduled_for) > unixepoch(${job}.occurrence_at) - ${job}.reminder_offset_minutes * 60`;
  return `MAX(${job}.lifetime_attempt_count, ${job}.attempt_count,
    CASE WHEN ${job}.sent_at IS NOT NULL OR ${job}.acked_at IS NOT NULL OR ${job}.status IN ('sent','acked','unconfirmed','processing') OR (${postponed}) THEN 1 ELSE 0 END,
    CASE WHEN ${job}.lifetime_attempt_count = 0 AND ${job}.attempt_count = 0 AND ${job}.status = 'scheduled' AND (${postponed}) THEN 4 ELSE 0 END)`;
}
// Legacy workers allowed at most 3 attempts. The fixed floor of 4 preserves an
// already accepted legacy snooze ahead of old failed duplicates. Persist this
// entire effective value before a claim or snooze changes its inferred state.
