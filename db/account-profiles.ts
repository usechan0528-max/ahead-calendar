import { env } from 'cloudflare:workers';
import { NICKNAME_CHANGE_INTERVAL_MS, type AccountProfileRecord } from '@/lib/account-profile';

// Prepared statements only; migrations own the schema. Profile handles never own schedules.
const fields = 'username, nickname, nickname_changed_at AS nicknameChangedAt, revision';
const databaseNow = "CAST(strftime('%s', 'now') AS INTEGER) * 1000";

function isNicknameConflict(error: unknown): boolean {
  // Only this exact constraint is a user-correctable collision. Other DB failures propagate.
  for (let cause = error, depth = 0; cause instanceof Error && depth < 4; cause = cause.cause, depth++) {
    if (cause.message.includes("UNIQUE constraint failed: index 'idx_account_profiles_nickname_unique'")) return true;
  }
  return false;
}

export async function readAccountProfile(ownerId: string) {
  return env.DB.prepare(`SELECT ${fields} FROM account_profiles WHERE owner_id = ?`).bind(ownerId).first<AccountProfileRecord>();
}

export async function createAccountProfile(ownerId: string, username: string, nickname: string) {
  const created = await env.DB.prepare(`INSERT INTO account_profiles
    (owner_id, username, nickname, nickname_changed_at, revision, created_at)
    VALUES (?, ?, ?, ${databaseNow}, 0, ${databaseNow})
    ON CONFLICT DO NOTHING RETURNING ${fields}`).bind(ownerId, username, nickname).first<AccountProfileRecord>();
  if (created) return { status: 'created', profile: created } as const;
  const current = await readAccountProfile(ownerId);
  if (current) return {
    status: current.username === username && current.nickname === nickname ? 'unchanged' : 'already_configured',
    profile: current,
  } as const;
  const usernameTaken = await env.DB.prepare('SELECT 1 FROM account_profiles WHERE username = ?').bind(username).first();
  if (usernameTaken) return { status: 'username_taken', profile: null } as const;
  const nicknameTaken = await env.DB.prepare('SELECT 1 FROM account_profiles WHERE lower(nickname) = lower(?)').bind(nickname).first();
  if (nicknameTaken) return { status: 'nickname_taken', profile: null } as const;
  // A nickname can be released between the failed INSERT and the read; do not mislabel it.
  return { status: 'retry', profile: null } as const;
}

export async function changeAccountNickname(ownerId: string, nickname: string, revision: number) {
  // Both cooldown and revision are checked in the actual write. Browser time is irrelevant.
  let changed: AccountProfileRecord | null;
  try {
    changed = await env.DB.prepare(`UPDATE account_profiles SET nickname = ?,
      nickname_changed_at = ${databaseNow}, revision = revision + 1
      WHERE owner_id = ? AND revision = ? AND nickname <> ?
        AND nickname_changed_at <= (${databaseNow}) - ?
      RETURNING ${fields}`).bind(nickname, ownerId, revision, nickname, NICKNAME_CHANGE_INTERVAL_MS).first<AccountProfileRecord>();
  } catch (error) {
    if (isNicknameConflict(error)) return { status: 'nickname_taken', profile: null } as const;
    throw error;
  }
  if (changed) return { status: 'changed', profile: changed } as const;
  const current = await readAccountProfile(ownerId);
  if (!current) return { status: 'missing', profile: null } as const;
  // A replay after a lost response must not extend the cooldown or create another revision.
  if (current.nickname === nickname) return { status: 'unchanged', profile: current } as const;
  return { status: current.revision !== revision ? 'conflict' : 'cooldown', profile: current } as const;
}
