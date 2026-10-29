export const NICKNAME_CHANGE_DAYS = 30;
export const NICKNAME_CHANGE_INTERVAL_MS = NICKNAME_CHANGE_DAYS * 24 * 60 * 60 * 1000;
export const USERNAME_RULE = '영문으로 시작하는 4~20자 · 영문, 숫자, 밑줄(_)';
export const NICKNAME_RULE = '2~16자 · 한글, 영문, 숫자, 밑줄(_)';

const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'support', 'official', 'system', 'root', 'moderator', 'to_j', 'to_j_support', 'j_scheduler']);

export function parseUsername(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 100 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const username = value.trim().toLowerCase();
  return /^[a-z][a-z0-9_]{3,19}$/.test(username) && !RESERVED_USERNAMES.has(username) ? username : null;
}

export function parseNickname(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 100 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const nickname = value.normalize('NFC').trim();
  return /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9_]{2,16}$/u.test(nickname) ? nickname : null;
}

export function hasExactProfileFields(body: Record<string, unknown>, fields: string[]) {
  return Object.keys(body).length === fields.length && fields.every(field => Object.hasOwn(body, field));
}

export interface AccountProfileRecord {
  username: string;
  nickname: string;
  nicknameChangedAt: number;
  revision: number;
}
export interface AccountProfile extends AccountProfileRecord {
  nextNicknameChangeAt: number;
  canChangeNickname: boolean;
}
export interface AccountProfileSnapshot {
  /** Non-secret account precondition, not an authentication credential. */
  accountScope: string;
  profile: AccountProfile | null;
  serverNow: number;
  nicknameChangeDays: number;
}

export function isAccountProfileSnapshot(value: unknown): value is AccountProfileSnapshot {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  if (typeof data.accountScope !== 'string' || !/^[a-f0-9]{64}$/.test(data.accountScope)) return false;
  if (!Number.isSafeInteger(data.serverNow) || data.nicknameChangeDays !== NICKNAME_CHANGE_DAYS) return false;
  if (data.profile === null) return true;
  if (!data.profile || typeof data.profile !== 'object') return false;
  const profile = data.profile as Record<string, unknown>;
  return typeof profile.username === 'string' && parseUsername(profile.username) === profile.username
    && typeof profile.nickname === 'string' && parseNickname(profile.nickname) === profile.nickname
    && Number.isSafeInteger(profile.nicknameChangedAt) && Number.isSafeInteger(profile.nextNicknameChangeAt)
    && Number.isSafeInteger(profile.revision) && (profile.revision as number) >= 0
    && typeof profile.canChangeNickname === 'boolean';
}

export function profileSnapshot(record: AccountProfileRecord | null, accountScope: string, now = Date.now()): AccountProfileSnapshot {
  const next = record ? record.nicknameChangedAt + NICKNAME_CHANGE_INTERVAL_MS : null;
  return {
    accountScope,
    profile: record && next !== null ? { ...record, nextNicknameChangeAt: next, canChangeNickname: now >= next } : null,
    serverNow: now,
    nicknameChangeDays: NICKNAME_CHANGE_DAYS,
  };
}

export function nicknameChangeDate(timestamp: number) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(timestamp);
}
