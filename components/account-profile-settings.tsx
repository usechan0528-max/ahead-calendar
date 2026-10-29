'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AppIcon } from './calendar-workspace';
import { useAccountProfile } from './use-account-profile';
import { useConnectionStatus } from './use-connection-status';
import { NICKNAME_RULE, USERNAME_RULE, isAccountProfileSnapshot, nicknameChangeDate, parseNickname, parseUsername, type AccountProfileSnapshot } from '@/lib/account-profile';

export function AccountProfileSettings() {
  const account = useAccountProfile();
  const online = useConnectionStatus();
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <div className="growth-detail-page profile-page">
    <a href="#profile-main" className="skip-link">본문으로 바로가기</a>
    <header className="growth-detail-header"><div><Link href="/" className="growth-detail-back" aria-disabled={saving} onClick={event => { if (saving) event.preventDefault(); }}><AppIcon name="left" size={22} />오늘로</Link><span className="growth-detail-brand">J에게</span></div></header>
    <main id="profile-main" tabIndex={-1}>
      <h1 ref={heading} tabIndex={-1}>내 프로필</h1>
      <p className="profile-intro">J에게에서 사용할 아이디와 이름이에요.</p>
      {!online && <p className="connection-notice" role="status">인터넷에 연결한 뒤 저장할 수 있어요.</p>}
      {message && <p className="profile-success" role="status">{message}</p>}
      {account.loading && <p className="profile-status" role="status">프로필을 불러오는 중…</p>}
      {account.error && <div className="profile-error" role="alert">{account.error}<button type="button" className="text-button" onClick={() => void account.refresh()} disabled={!online || account.loading || saving}>다시 불러오기</button></div>}
      {account.unauthorized && <div className="profile-card"><p>로그인한 뒤 내 프로필을 설정할 수 있어요.</p><a href="/signin-with-chatgpt?return_to=%2Fprofile" target="_top" className="primary-button">로그인</a></div>}
      {account.snapshot && !account.unauthorized && <AccountProfileForm key={account.version} snapshot={account.snapshot} unavailable={account.loading || !!account.error || !online}
        onBusy={setSaving} onSaved={data => { account.accept(data); setMessage(account.snapshot?.profile ? '닉네임을 변경했어요.' : '프로필을 설정했어요.'); }}
        onRefresh={() => { setMessage(''); void account.refresh(); }} />}
    </main>
  </div>;
}

function AccountProfileForm({ snapshot, unavailable, onSaved, onBusy, onRefresh }: {
  snapshot: AccountProfileSnapshot; unavailable: boolean;
  onSaved: (snapshot: AccountProfileSnapshot) => void; onBusy: (busy: boolean) => void; onRefresh: () => void;
}) {
  const profile = snapshot.profile;
  const [username, setUsername] = useState(profile?.username ?? '');
  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [confirmation, setConfirmation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [nicknameTaken, setNicknameTaken] = useState(false);
  const nicknameInput = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); }; }, []);
  useEffect(() => { if (confirmation) confirmButton.current?.focus(); }, [confirmation]);
  useEffect(() => { if (nicknameTaken && !saving) nicknameInput.current?.focus(); }, [nicknameTaken, saving]);
  const canonicalUsername = parseUsername(username), canonicalNickname = parseNickname(nickname);
  const locked = !!profile && !profile.canChangeNickname;
  const changed = !profile || canonicalNickname !== profile.nickname;
  const disabled = unavailable || saving || locked || needsReload;

  function review(event: FormEvent) {
    event.preventDefault();
    if (disabled || !changed || lock.current) return;
    if (!canonicalUsername) { setError(`사용할 수 있는 아이디를 입력해 주세요. ${USERNAME_RULE}.`); return; }
    if (!canonicalNickname) { setError(`닉네임을 확인해 주세요. ${NICKNAME_RULE}.`); return; }
    setError(null); setNicknameTaken(false); setConfirmation(true);
  }

  async function save() {
    if (!confirmation || disabled || lock.current || !canonicalUsername || !canonicalNickname) return;
    lock.current = true; setSaving(true); onBusy(true); setError(null);
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch('/api/profile', {
        method: profile ? 'PATCH' : 'POST', cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-ToJ-Profile': '1', 'X-ToJ-Profile-Account': snapshot.accountScope },
        body: JSON.stringify(profile ? { nickname: canonicalNickname, revision: profile.revision } : { username: canonicalUsername, nickname: canonicalNickname }),
      });
      const data: unknown = await response.json();
      if (!alive.current) return;
      if (!response.ok) {
        const failure = data && typeof data === 'object' ? data as Record<string, unknown> : {};
        setError(typeof failure.error === 'string' ? failure.error : '저장하지 못했어요. 입력 내용을 확인해 주세요.');
        setNicknameTaken(failure.code === 'nickname_taken');
        setNeedsReload(typeof failure.code !== 'string' || !['invalid_username', 'invalid_nickname', 'username_taken', 'nickname_taken', 'profile_retry'].includes(failure.code));
        setConfirmation(false); return;
      }
      if (!isAccountProfileSnapshot(data) || !data.profile) throw new Error('Missing saved profile');
      onSaved(data);
    } catch {
      if (alive.current) { setError('저장 결과를 확인하지 못했어요. 현재 정보를 다시 불러와 확인해 주세요.'); setNeedsReload(true); setConfirmation(false); }
    } finally {
      window.clearTimeout(timeout); lock.current = false;
      onBusy(false);
      if (alive.current) setSaving(false);
    }
  }

  return <section className="profile-card">
    {profile && <div className="profile-identity"><span className="profile-avatar" aria-hidden="true">{profile.nickname.slice(0, 1)}</span><div><h2>{profile.nickname}</h2><p>@{profile.username}</p></div></div>}
    <form onSubmit={review} aria-busy={saving}>
      <div className="profile-field"><label htmlFor="profile-username">아이디{profile && <span className="profile-fixed">변경 불가</span>}</label>
        <div className="profile-username-input"><span aria-hidden="true">@</span><input id="profile-username" name="username" value={username} readOnly={!!profile} disabled={saving || unavailable} required maxLength={20} autoComplete="username" autoCapitalize="none" spellCheck={false}
          aria-describedby="profile-username-help" onChange={event => { setUsername(event.target.value); setConfirmation(false); setError(null); }} placeholder="my_toj" /></div>
        <p id="profile-username-help">{profile ? '처음 설정한 아이디를 계속 사용해요.' : USERNAME_RULE}</p>
      </div>
      <div className="profile-field"><label htmlFor="profile-nickname">닉네임</label>
        <input ref={nicknameInput} id="profile-nickname" name="nickname" value={nickname} readOnly={locked} disabled={saving || unavailable || needsReload} required maxLength={32} autoComplete="nickname" spellCheck={false}
          aria-invalid={nicknameTaken || undefined} aria-describedby={`profile-nickname-help profile-change-rule${nicknameTaken ? ' profile-save-error' : ''}`} onChange={event => { setNickname(event.target.value); setConfirmation(false); setError(null); setNicknameTaken(false); }} placeholder="차근차근" />
        <p id="profile-nickname-help">{NICKNAME_RULE} · 중복 불가</p>
      </div>
      <div className={`profile-change-rule ${locked ? 'is-locked' : ''}`} id="profile-change-rule">
        <AppIcon name="calendar" size={20} /><div><strong>{locked ? '다음 닉네임 변경' : `닉네임은 ${snapshot.nicknameChangeDays}일에 한 번`}</strong>
          <p>{locked && profile ? `${nicknameChangeDate(profile.nextNicknameChangeAt)}부터 (한국 시간)` : profile ? '변경하면 30일 뒤에 다시 바꿀 수 있어요.' : '처음 설정한 날부터 적용돼요.'}</p></div>
      </div>
      {error && <p id="profile-save-error" className="profile-error" role="alert">{error}</p>}
      {needsReload || locked ? <button type="button" className="text-button" disabled={saving || unavailable} onClick={onRefresh}>{needsReload ? '현재 정보 다시 불러오기' : '변경 가능 여부 새로 확인'}</button>
        : confirmation ? <div className="profile-confirm" role="group" aria-labelledby="profile-confirm-title">
          <h3 id="profile-confirm-title">{profile ? `${canonicalNickname}(으)로 변경할까요?` : '이 프로필로 시작할까요?'}</h3>
          {!profile && <p><strong>@{canonicalUsername}</strong> · {canonicalNickname}<br />아이디는 설정 후 바꿀 수 없어요.</p>}
          <p>닉네임은 저장 후 30일 동안 변경할 수 없어요.</p>
          <div><button ref={confirmButton} type="button" className="primary-button" disabled={disabled} onClick={() => void save()}>{saving ? '저장 중…' : profile ? '변경하기' : '설정하기'}</button><button type="button" className="text-button" disabled={saving} onClick={() => setConfirmation(false)}>다시 수정</button></div>
        </div> : <button type="submit" className="primary-button profile-save" disabled={disabled || !changed}>{profile ? '닉네임 변경' : '프로필 설정'}</button>}
    </form>
    <details className="profile-policy"><summary>아이디·닉네임 안내</summary><ul>
      <li>아이디는 다른 사람과 중복되지 않으며, 영문 대문자는 소문자로 저장해요. 일부 운영용 아이디는 사용할 수 없어요.</li>
      <li>닉네임은 다른 사람과 중복될 수 없어요. 영문 대소문자는 구분하지 않으며, 앞뒤 공백은 제거해요.</li>
      <li>한글 자모도 사용할 수 있지만 공백·특수문자·이모지는 사용할 수 없어요. 중복으로 저장하지 못한 경우 변경 대기 기간은 늘어나지 않아요.</li>
      <li>아이디와 닉네임은 내 프로필 정보예요. 현재 로그인 방식과 일정·성장 기록은 바뀌지 않아요.</li>
    </ul></details>
  </section>;
}
