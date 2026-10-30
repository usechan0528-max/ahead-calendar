# J에게 — 비밀번호 찾기·재설정 로직 준비

작성: 2026-09-20. 상태: **미연결 로직과 가짜 어댑터 테스트만 준비**.

기존 `ACCOUNT_AUTH_DESIGN.md`의 Supabase Auth 위임 방향을 따른다. 비밀번호를 찾아 보여주거나 메일로 전송하지 않는다. 실제 메일 발송, Supabase 생성·연결, DB 변경, API 공개, 화면 추가, 배포는 하지 않았다. 현재 Sites 인증과 일정·경험치 소유권은 그대로 유지한다.

## 구현 범위

- `lib/auth/password-recovery.ts`: 입력 검증, 고정 복구 URL, 동일한 요청 응답, 복구 권한 검증, 일회성 claim, 비밀번호 변경·세션 종료의 상태 분기.
- `scripts/test-password-recovery.mjs`: 외부 통신 없는 단위 테스트. `node scripts/test-password-recovery.mjs`로 실행한다.
- `createPasswordRecoveryService()`는 기본적으로 503 `recovery_not_connected`를 반환한다. 서버 설정과 모든 실제 어댑터를 명시적으로 공급해야 작동한다. 앱의 어떤 route에서도 가져오지 않는다.

## 예정 흐름

1. 사용자가 이메일을 입력한다. 서버가 POST·정확한 Origin·CSRF를 검증한다.
2. 이메일의 양끝 공백과 대소문자만 정리한다. 점·`+태그`를 없애거나 계정을 합치지 않는다. 공급자 이메일 정규화와 일치하는지는 실제 연결 시 확인한다.
3. 계정 존재 여부를 조회하지 않는 제한된 내구성 큐에 요청한다. 큐 처리·제한·장애 여부와 관계없이 같은 202 안내를 반환한다. 발송 성공이라고 단정하지 않는다.
4. 비공개 큐 작업자가 Supabase `resetPasswordForEmail`에 고정된 `https://<확정 도메인>/account/recovery`를 전달한다. 현재 이 작업자는 미구현이다. 메일 요청 자체로 가입하거나 비밀번호를 바꾸지 않는다.
5. 서버가 공급자의 **복구 전용 검증 교환 결과**로 짧은 수명의 복구 grant를 만든다. 일반 로그인 세션이나 클라이언트 이벤트만으로 만들지 않는다. 이 교환 어댑터도 아직 미구현이다.
6. 새 비밀번호와 확인 값이 일치하면 원자적으로 grant를 점유한다. 검증된 공급자 계정에만 비밀번호 변경을 요청한다.
7. 변경 이후 기존 세션과 복구 세션을 종료하고 상태 저장까지 확인한다. 자동 로그인하지 않고 새 비밀번호로 로그인하도록 안내한다.

## 복구 권한·경합 규칙

`purpose: password_recovery`는 우리 서버가 검증한 흐름을 표현하는 내부 필드다. Supabase JWT에 이 필드가 존재한다고 가정하지 않는다. JWT decode, URL 파라미터, 이메일, 일반 access token, 브라우저의 `PASSWORD_RECOVERY` 이벤트를 단독 증거로 사용하지 않는다.

서버가 issuer·subject·복구 세션 식별자·만료·브라우저 바인딩을 검증한 후, 충분한 난수의 불투명 handle을 발급한다. 원문 토큰은 서버에서만 취급한다. 브라우저 바인딩은 Secure/HttpOnly/SameSite 쿠키로 유지한다. 본문에서 ownerId·subject·redirectTo를 받지 않는다. `RecoveryContext`의 검증 결과와 제한 키도 서버에서만 만든다.

실제 `grants.claim`은 공유 저장소의 트랜잭션/CAS로 다음을 한 번에 처리해야 한다.

- handle·쿠키·issuer·복구 목적·만료·최신 복구 세대를 확인한다. 만료는 전달된 요청 시각뿐 아니라 실제 트랜잭션 시각으로 검사한다. 서비스도 claim 반환 후 변경 직전에 시각을 다시 검사한다.
- 출처·grant·계정별 시도 제한을 적용한다.
- `ready → applying`을 단 한 번 수행한다. 동일 계정의 서로 다른 grant도 직렬화한다.
- 새 복구 grant 발급 시 이전 미사용 grant를 무효화한다. 이미 실행 중인 변경과 충돌하지 않도록 한다.
- `applying`/결과 불명 상태를 시간 초과만으로 `ready`로 되돌리지 않는다. 새 grant도 미확인 실행을 우회하지 못하게 한다.

메일 토큰의 만료·재발급·일회성 검증은 공급자가 담당한다. 그와 별개로 서버 grant의 수명은 `maxGrantAgeMs`로 제한한다. 실제 값은 연결 시 결정하며 테스트의 10분이 운영 설정은 아니다. 메일 링크 재발급과 오래된 링크의 무효화는 공급자 통합 테스트로 확인해야 한다.

## 오류와 상태

| 상황 | 기록/응답 | 이후 처리 |
| --- | --- | --- |
| 잘못된 입력 | claim 전 400 | 입력 수정 가능 |
| 잘못되거나 소비된 복구 권한 | 410 | 새 복구 절차 필요 |
| 공급자가 변경 거절을 확정 | `rejected` | 같은 grant 재사용 금지 |
| 타임아웃·변경 여부 불명 | `change_unknown` | 비밀번호 변경 자동 재시도 금지, 확인·조정 필요 |
| 변경 성공 | `password_changed` | 세션 종료 수행 |
| 세션 종료 실패 | `revocation_pending` | 비밀번호 변경 없이 세션 종료만 재시도 |
| 변경·세션 종료·상태 저장 확인 | `completed` | 복구 쿠키 삭제 후 일반 로그인 |

상태 저장이 실패해도 이미 점유한 grant를 열지 않는다. 변경 완료를 확인한 경우 상태 저장 실패에도 세션 종료를 시도한다. 전체 완료가 확인되지 않으면 성공으로 표시하지 않는다. 응답 유실 후 재요청도 비밀번호 변경을 다시 수행하지 않는다. 장애 복구 작업자와 지원 절차는 실제 연결 전에 구현해야 한다.

`clearRecoveryCookie`는 향후 HTTP 어댑터가 쿠키를 지우라는 지시일 뿐 실제 로그아웃 구현이 아니다. Supabase의 로그아웃은 이미 발급된 access JWT를 즉시 무효화하지 않을 수 있으므로, 전체 세션 종료 어댑터는 서버의 세션 버전/차단 확인도 포함해야 한다. 현재의 Sites 세션을 Supabase 세션이라고 간주하거나 삭제하지 않는다.

## 연결 전 필수 항목 — 아직 미구현/미검증

- Supabase 설정, 실제 비밀번호 정책, 복구 토큰 만료, 이메일 템플릿, 검증된 발송 도메인/SMTP. 비밀번호 강도·유출 비밀번호 차단 등은 공급자 정책으로 최종 검증한다.
- 내구성 큐 및 공유 제한 저장소. IP 원문을 로그에 남기지 않는 출처 키, 이메일 기반 제한, 전역 제한, 실패 모니터링. 큐에는 이메일만 필요한 기간 동안 보관하고 비밀번호·복구 토큰을 넣지 않는다.
- PKCE/복구 교환 및 보호된 서버 grant 저장소. 실제 공급자 오류를 `rejected`/`unknown`으로 안전하게 구분한다. 어댑터에 제한시간을 두고 비밀번호 변경의 자동 네트워크 재시도를 끈다. 네트워크 오류를 변경 실패 확정으로 오인하지 않는다. timeout 응답 후 공급자가 늦게 성공해도 새 grant로 재변경하지 않도록 조정 작업자와 통합 테스트로 확인한다.
- 실제 HTTP 어댑터의 JSON 크기/Content-Type 제한, CSRF, Secure 쿠키, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. URL·요청 본문·토큰 로그 마스킹. 복구 페이지에 분석/외부 스크립트 금지.
- 공급자 callback allowlist에 정확한 운영 URL만 등록한다. Host 헤더나 사용자 redirectTo를 사용하지 않는다. Sites 예약 `/callback`·`/signin-with-chatgpt`·`/signout-with-chatgpt`는 변경하지 않는다.
- 메일 보안 스캐너의 GET 방문만으로 비밀번호 변경을 실행하지 않도록 복구 확인 UX 설계. 네이티브 앱은 별도 검증된 PKCE/deep-link 흐름으로 연결한다.
- 전 세션 무효화와 기존 API의 세션 버전 검사, 장애 후 조정 작업자. 완료 후 비밀번호를 포함하지 않는 보안 알림 메일을 보낼 작업자.
- 일반 계정/미가입 계정의 상태·본문·실제 응답 시간 차이, 공급자 제한, 재발급, 다른 계정의 동시 복구, 다른 프로세스의 동시 요청, 재시작, 메일 전달 및 만료 시나리오 통합 테스트.

가짜 저장소의 동시성 테스트는 호출 순서만 검증한다. 실제 DB 원자성, 메일 전달, Supabase 복구 권한, 계정 미노출의 시간 특성, JWT 무효화가 검증됐다는 의미가 아니다. 운영용 메모리 저장소나 임시 성공 어댑터를 추가해서 연결하지 않는다.

## 참고 문서

- [Supabase 비밀번호 인증](https://supabase.com/docs/guides/auth/passwords) — 비밀번호 처리는 인증 공급자에 위임한다.
- [Supabase 재설정 이메일 API](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail) — 재설정 메일과 후속 비밀번호 변경 흐름.
- [Supabase 로그아웃 API](https://supabase.com/docs/reference/javascript/auth-signout) — access JWT 만료와 로그아웃의 한계.
- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) — 일관된 응답, 일회성·만료, 자동 로그인 금지, 세션 정리 원칙을 반영했다.
