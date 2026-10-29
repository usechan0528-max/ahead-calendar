import { getOwnerId } from '@/app/api/owner';
import { changeAccountNickname, createAccountProfile, readAccountProfile } from '@/db/account-profiles';
import { hasExactProfileFields, parseNickname, parseUsername, profileSnapshot, NICKNAME_RULE, USERNAME_RULE } from '@/lib/account-profile';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, oai-authenticated-user-id' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

async function accountScope(owner: string) {
  // Not a secret or authorization token: binds the displayed form to its account.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`to-j-profile-v1\u0000${owner}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readProfileBody(request: Request, scope: string): Promise<Record<string, unknown> | Response> {
  // The dispatcher preserves the request URL. Never use caller-provided forwarded hosts.
  if (request.headers.get('origin') !== new URL(request.url).origin
    || request.headers.get('x-toj-profile') !== '1'
    || request.headers.get('sec-fetch-site') === 'cross-site') {
    return json({ error: '허용되지 않은 요청이에요.', code: 'request_denied' }, 403);
  }
  if (request.headers.get('x-toj-profile-account') !== scope) {
    return json({ error: '로그인 계정이 바뀌었거나 프로필 확인이 필요해요. 현재 정보를 다시 불러와 주세요.', code: 'account_changed' }, 409);
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'JSON 형식으로 요청해 주세요.', code: 'invalid_content_type' }, 415);
  }
  const reader = request.body?.getReader();
  if (!reader) return json({ error: '입력 내용을 확인해 주세요.', code: 'invalid_body' }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); return json({ error: '입력 내용이 너무 길어요.', code: 'body_too_large' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch { /* Return no raw input or decoder/provider error. */ }
  finally { reader.releaseLock(); }
  return json({ error: '입력 내용을 확인해 주세요.', code: 'invalid_body' }, 400);
}

export async function GET() {
  const owner = await getOwnerId();
  if (!owner) return json({ error: '로그인이 필요해요.', code: 'unauthorized' }, 401);
  try { return json(profileSnapshot(await readAccountProfile(owner), await accountScope(owner))); }
  catch { console.error('profile.read_failed'); return json({ error: '프로필을 불러오지 못했어요. 다시 시도해 주세요.', code: 'unavailable' }, 503); }
}

export async function POST(request: Request) {
  const owner = await getOwnerId();
  if (!owner) return json({ error: '로그인이 필요해요.', code: 'unauthorized' }, 401);
  const scope = await accountScope(owner);
  const body = await readProfileBody(request, scope);
  if (body instanceof Response) return body;
  if (!hasExactProfileFields(body, ['username', 'nickname'])) return json({ error: '아이디와 닉네임만 입력해 주세요.', code: 'invalid_fields' }, 400);
  const username = parseUsername(body.username), nickname = parseNickname(body.nickname);
  if (!username) return json({ error: `아이디를 확인해 주세요. ${USERNAME_RULE}. 일부 운영용 아이디는 사용할 수 없어요.`, code: 'invalid_username' }, 400);
  if (!nickname) return json({ error: `닉네임을 확인해 주세요. ${NICKNAME_RULE}.`, code: 'invalid_nickname' }, 400);
  try {
    const result = await createAccountProfile(owner, username, nickname);
    if (result.status === 'username_taken') return json({ error: '이미 사용 중인 아이디예요. 다른 아이디를 입력해 주세요.', code: result.status }, 409);
    if (result.status === 'nickname_taken') return json({ error: '이미 사용 중인 닉네임이에요. 다른 닉네임을 입력해 주세요.', code: result.status }, 409);
    if (result.status === 'retry') return json({ error: '저장 중 정보가 바뀌었어요. 다시 저장해 주세요.', code: 'profile_retry' }, 409);
    if (result.status === 'already_configured') return json({ error: '이미 프로필을 설정했어요. 현재 정보를 다시 확인해 주세요.', code: result.status, ...profileSnapshot(result.profile, scope) }, 409);
    return json(profileSnapshot(result.profile, scope), result.status === 'created' ? 201 : 200);
  } catch { console.error('profile.create_failed'); return json({ error: '저장 결과를 확인하지 못했어요. 현재 정보를 다시 불러와 확인해 주세요.', code: 'save_unknown' }, 503); }
}

export async function PATCH(request: Request) {
  const owner = await getOwnerId();
  if (!owner) return json({ error: '로그인이 필요해요.', code: 'unauthorized' }, 401);
  const scope = await accountScope(owner);
  const body = await readProfileBody(request, scope);
  if (body instanceof Response) return body;
  if (!hasExactProfileFields(body, ['nickname', 'revision'])) return json({ error: '닉네임만 변경할 수 있어요.', code: 'invalid_fields' }, 400);
  const nickname = parseNickname(body.nickname);
  if (!nickname || !Number.isSafeInteger(body.revision) || (body.revision as number) < 0) return json({ error: `닉네임을 확인해 주세요. ${NICKNAME_RULE}.`, code: 'invalid_nickname' }, 400);
  try {
    const result = await changeAccountNickname(owner, nickname, body.revision as number);
    if (result.status === 'missing') return json({ error: '먼저 아이디와 닉네임을 설정해 주세요.', code: result.status }, 404);
    if (result.status === 'nickname_taken') return json({ error: '이미 사용 중인 닉네임이에요. 다른 닉네임을 입력해 주세요.', code: result.status }, 409);
    const snapshot = profileSnapshot(result.profile, scope);
    if (result.status === 'conflict') return json({ error: '다른 곳에서 프로필이 변경됐어요. 현재 정보를 다시 확인해 주세요.', code: result.status, ...snapshot }, 409);
    if (result.status === 'cooldown') return json({ error: '닉네임은 마지막 설정으로부터 30일 후에 변경할 수 있어요.', code: result.status, ...snapshot }, 429);
    return json(snapshot);
  } catch { console.error('profile.change_failed'); return json({ error: '변경 결과를 확인하지 못했어요. 현재 정보를 다시 불러와 확인해 주세요.', code: 'save_unknown' }, 503); }
}
