import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex, check, primaryKey } from 'drizzle-orm/sqlite-core';

export const accountProfiles = sqliteTable('account_profiles', {
  ownerId: text('owner_id').primaryKey().notNull(),
  username: text('username').notNull(),
  nickname: text('nickname').notNull(),
  nicknameChangedAt: integer('nickname_changed_at').notNull(),
  revision: integer('revision').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, table => [
  uniqueIndex('idx_account_profiles_username').on(table.username),
  // Stored nicknames are NFC with Hangul/ASCII only; lower() folds allowed English letters.
  uniqueIndex('idx_account_profiles_nickname_unique').on(sql`lower(nickname)`),
  check('account_profiles_username_format', sql`length(${table.username}) BETWEEN 4 AND 20 AND ${table.username} NOT GLOB '*[^a-z0-9_]*' AND substr(${table.username}, 1, 1) GLOB '[a-z]'`),
  check('account_profiles_nickname_length', sql`length(${table.nickname}) BETWEEN 2 AND 16`),
  check('account_profiles_revision', sql`${table.revision} >= 0`),
  check('account_profiles_timestamps', sql`${table.createdAt} >= 0 AND ${table.nicknameChangedAt} >= ${table.createdAt}`),
]);

export const eventCategoryColors = sqliteTable('event_category_colors', {
  ownerId: text('owner_id').notNull(),
  category: text('category').notNull(),
  color: text('color').notNull(),
}, table => [primaryKey({ columns: [table.ownerId, table.category] })]);

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerId: text('owner_id').notNull(),
    title: text('title').notNull(),
    category: text('category').notNull(),
    eventDate: text('event_date').notNull(),
    eventTime: text('event_time').notNull(),
    allDay: integer('all_day').notNull().default(0),
    allDayReminderTime: text('all_day_reminder_time').notNull().default('09:00'),
    endDate: text('end_date'),
    endTime: text('end_time'),
    location: text('location').notNull().default(''),
    placeJson: text('place_json'),
    travelPlanJson: text('travel_plan_json'),
    note: text('note').notNull().default(''),
    preparationsEnabled: integer('preparations_enabled').notNull().default(1),
    recurrence: text('recurrence').notNull().default('none'),
    recurrenceInterval: integer('recurrence_interval').notNull().default(1),
    recurrenceDay: integer('recurrence_day'),
    recurrenceUntil: text('recurrence_until'),
    notificationRevision: integer('notification_revision').notNull().default(0),
    remindersChangedAt: text('reminders_changed_at').notNull().default(''),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_events_owner_date').on(table.ownerId, table.eventDate)],
);

export const routeRequestLimits = sqliteTable('route_request_limits', {
  ownerId: text('owner_id').primaryKey(),
  requestDay: text('request_day').notNull(),
  requestCount: integer('request_count').notNull(),
  lastRequestAt: integer('last_request_at').notNull(),
});

// No cascading FK: a replay must not resurrect an event the member deleted.
export const eventCreationReceipts = sqliteTable('event_creation_receipts', {
  ownerId: text('owner_id').notNull(),
  requestId: text('request_id').notNull(),
  payloadHash: text('payload_hash').notNull(),
  eventId: integer('event_id').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [primaryKey({ columns: [table.ownerId, table.requestId] })]);

export const reminderRules = sqliteTable(
  'reminder_rules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    offsetMinutes: integer('offset_minutes').notNull(),
    channel: text('channel').notNull().default('push'),
    repeatUntilAck: integer('repeat_until_ack', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [index('idx_reminder_rules_event_id').on(table.eventId)],
);

export const preparationItems = sqliteTable(
  'preparation_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    timing: text('timing').notNull(),
    status: text('status').notNull().default('pending'),
    legacyCompleted: integer('legacy_completed').notNull().default(0),
    legacyCompletedDate: text('legacy_completed_date'),
    source: text('source').notNull().default('rule'),
    recommendationKey: text('recommendation_key'),
  },
  (table) => [index('idx_preparation_items_event_id').on(table.eventId), uniqueIndex('idx_preparation_recommendation').on(table.eventId, table.recommendationKey)],
);

export const recommendationSettings = sqliteTable('recommendation_settings', {
  eventId: integer('event_id').primaryKey().references(() => events.id, { onDelete: 'cascade' }),
  profile: text('profile').notNull().default('auto'),
  revision: integer('revision').notNull().default(0),
});

// The adoption receipt survives checklist deletion, retaining stable recommendation identity.
export const recommendationState = sqliteTable('recommendation_state', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  ruleKey: text('rule_key').notNull(),
  preparationId: integer('preparation_id'),
  dismissed: integer('dismissed').notNull().default(0),
}, (table) => [uniqueIndex('idx_recommendation_state_event_rule').on(table.eventId, table.ruleKey)]);

export const notificationDeliveries = sqliteTable(
  'notification_deliveries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerId: text('owner_id').notNull(),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull().default('browser'),
    kind: text('kind').notNull().default('test'),
    status: text('status').notNull().default('sent'),
    sentAt: text('sent_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_notification_deliveries_owner_sent').on(table.ownerId, table.sentAt)],
);

export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerId: text('owner_id').notNull(),
    endpoint: text('endpoint').notNull().unique(),
    expirationTime: integer('expiration_time'),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent').notNull().default(''),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSuccessAt: text('last_success_at'),
    failureCount: integer('failure_count').notNull().default(0),
    disabledAt: text('disabled_at'),
    remindersEnabledAt: text('reminders_enabled_at'),
  },
  (table) => [
    index('idx_push_subscriptions_owner_active').on(table.ownerId, table.disabledAt),
  ],
);

export const eventOccurrenceOverrides = sqliteTable('event_occurrence_overrides', {
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  originalDate: text('original_date').notNull(),
  cancelled: integer('cancelled').notNull().default(0),
  dataJson: text('data_json'),
  updatedAt: text('updated_at').notNull(),
}, (t) => [uniqueIndex('idx_occurrence_override_identity').on(t.eventId, t.originalDate),
  check('occurrence_override_cancelled', sql`${t.cancelled} IN (0, 1)`)]);

export const notificationJobs = sqliteTable(
  'notification_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerId: text('owner_id').notNull(),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    subscriptionId: integer('subscription_id')
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('test'),
    occurrenceAt: text('occurrence_at'),
    originalOccurrenceDate: text('original_occurrence_date'),
    reminderOffsetMinutes: integer('reminder_offset_minutes'),
    eventRevision: integer('event_revision'),
    expiresAt: text('expires_at'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    scheduledFor: text('scheduled_for').notNull(),
    status: text('status').notNull().default('scheduled'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lifetimeAttemptCount: integer('lifetime_attempt_count').notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    claimedAt: text('claimed_at'),
    sentAt: text('sent_at'),
    ackedAt: text('acked_at'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_notification_jobs_status_scheduled').on(table.status, table.scheduledFor),
    index('idx_notification_jobs_owner_created').on(table.ownerId, table.createdAt),
    index('idx_notification_jobs_event_status').on(table.eventId, table.status),
  ],
);

export const notificationSchedulerState = sqliteTable('notification_scheduler_state', {
  id: integer('id').primaryKey(),
  lastCompletedAt: text('last_completed_at').notNull(),
});

export const notificationSchedulerNonces = sqliteTable('notification_scheduler_nonces', {
  nonce: text('nonce').primaryKey(),
  receivedAt: integer('received_at').notNull(),
}, (table) => [index('idx_scheduler_nonces_received').on(table.receivedAt)]);

export const notificationPlannerState = sqliteTable('notification_planner_state', {
  id: integer('id').primaryKey(),
  lastEventId: integer('last_event_id').notNull().default(0),
});

// Mutable per-occurrence checks. XP history intentionally has no cascading FK.
export const occurrenceCompletions = sqliteTable('occurrence_completions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerId: text('owner_id').notNull(),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  occurrenceDate: text('occurrence_date').notNull(),
  kind: text('kind').notNull(),
  itemId: integer('item_id').notNull().default(0),
  complete: integer('complete').notNull().default(0),
  mutationId: text('mutation_id').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [uniqueIndex('idx_completion_identity').on(t.ownerId, t.eventId, t.occurrenceDate, t.kind, t.itemId),
  index('idx_completion_owner_date').on(t.ownerId, t.occurrenceDate),
  check('completion_boolean', sql`${t.complete} IN (0, 1)`),
  check('completion_kind', sql`${t.kind} IN ('event', 'preparation')`)]);

export const xpLedger = sqliteTable('xp_ledger', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerId: text('owner_id').notNull(),
  actionKey: text('action_key').notNull(),
  kind: text('kind').notNull(),
  earnedDate: text('earned_date').notNull(),
  xp: integer('xp').notNull(),
  rulesVersion: integer('rules_version').notNull().default(1),
  createdAt: text('created_at').notNull(),
}, (t) => [uniqueIndex('idx_xp_identity').on(t.ownerId, t.actionKey),
  index('idx_xp_owner_date').on(t.ownerId, t.earnedDate),
  check('xp_bounded', sql`${t.xp} >= 0 AND ${t.xp} <= 60`)]);

export const dailyGoals = sqliteTable('daily_goals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerId: text('owner_id').notNull(),
  day: text('day').notNull(),
  target: integer('target').notNull().default(3),
}, (t) => [uniqueIndex('idx_goal_owner_day').on(t.ownerId, t.day),
  check('goal_target_range', sql`${t.target} BETWEEN 1 AND 5`)]);
