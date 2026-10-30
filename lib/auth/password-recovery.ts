/**
 * Server-only orchestration prepared for a future Supabase Auth adapter.
 * Deliberately NOT imported by any route. No credentials, DB, mailer or live defaults.
 */
export const RECOVERY_CALLBACK_PATH = "/account/recovery";

export interface RecoveryConfig {
  /** Canonical HTTPS origin from server configuration, never Host/forwarded headers. */
  origin: string;
  issuer: string;
  /** Lifetime of the server recovery grant, NOT the provider email-token lifetime. */
  maxGrantAgeMs: number;
  /** Must match the eventual provider policy. Passwords are never trimmed. */
  passwordPolicy: { minLength: number; maxLength: number; maxUtf8Bytes: number };
}

export interface RecoveryContext {
  method: string;
  origin: string | null;
  /** Set by server CSRF verification, never copied from request JSON. */
  csrfVerified: boolean;
  /** Server-derived, privacy-preserving rate-limit key. Never client-selected. */
  sourceKey: string;
  /** Opaque server-side recovery grant and Secure/HttpOnly cookie binding. */
  recoveryHandle?: string;
  browserBinding?: string;
}

export interface RecoveryGrant {
  claimId: string;
  issuer: string;
  subject: string;
  recoverySessionId: string;
  /** Internal verified-flow marker, NOT an assumed provider JWT claim. */
  purpose: "password_recovery";
  issuedAt: number;
  expiresAt: number;
  /** Server-only reference to provider credentials; never return to the browser. */
  credentialRef: string;
}

export type RecoveryState =
  | "rejected"
  | "change_unknown"
  | "password_changed"
  | "revocation_pending"
  | "completed";

export type RecoveryAuditEvent =
  | "request_queue_unavailable"
  | "grant_store_unavailable"
  | "grant_rejected"
  | "change_unknown"
  | "state_write_failed"
  | "revocation_pending";

export interface RecoveryPorts {
  now(): number;
  requests: {
    /**
     * Durable, account-independent enqueue with atomic source/email/global limits.
     * Return identically for queued and suppressed requests. No account lookup here.
     * A private worker calls the provider's resetPasswordForEmail with this fixed URL.
     * Protect queued email at rest and delete it after a bounded retention period.
     */
    enqueue(input: { email: string; sourceKey: string; redirectTo: string }): Promise<void>;
  };
  grants: {
    /**
     * Atomically claim ready -> applying, bound to cookie + verified recovery flow.
     * Must enforce expiry, latest generation, rate limits and per-account exclusion.
     * Check expiry against the actual transaction time, not just input.now.
     * A normal login session is NEVER sufficient. A consumed/unknown claim must not
     * return to ready, even after a timeout, crash or failed state write.
     */
    claim(input: {
      handle: string;
      browserBinding: string;
      sourceKey: string;
      now: number;
      issuer: string;
      maxGrantAgeMs: number;
    }): Promise<RecoveryGrant | null>;
    /** Durable, idempotent, monotonic checkpoint; never stores a password/token. */
    record(claimId: string, state: RecoveryState): Promise<void>;
  };
  provider: {
    /**
     * Operates only on the issuer/subject/session bound to the verified grant.
     * Enforce a bounded deadline and disable automatic transport retries. A timeout
     * is unknown, even if the provider may finish later; reconcile before new grants.
     */
    changePassword(grant: RecoveryGrant, password: string): Promise<"changed" | "rejected" | "unknown">;
    /**
     * Includes the recovery session and all prior sessions. True requires both
     * provider refresh-session revocation and application session fencing; signing
     * out alone may leave already-issued access JWTs usable until their expiry.
     */
    revokeSessions(grant: RecoveryGrant): Promise<boolean>;
  };
  /** Sanitized codes only; do not log passwords, emails, links or provider errors. */
  audit?(event: RecoveryAuditEvent): void;
}

export interface RecoveryResult {
  status: number;
  code: string;
  message: string;
  /** Server adapter clears the local recovery cookie; this does not revoke JWTs. */
  clearRecoveryCookie: boolean;
}

function result(status: number, code: string, message: string, clearRecoveryCookie = false): RecoveryResult {
  return { status, code, message, clearRecoveryCookie };
}

function reference(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

function exactFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function emailAddress(value: unknown): string | null {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const email = value.trim().toLowerCase();
  // Intentionally conservative input boundary; the provider remains authoritative.
  if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(email)) return null;
  const local = email.slice(0, email.indexOf("@"));
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  return email;
}

function validConfig(config: RecoveryConfig): boolean {
  try {
    const url = new URL(config.origin);
    const policy = config.passwordPolicy;
    return url.protocol === "https:" && url.origin === config.origin
      && reference(config.issuer)
      && Number.isSafeInteger(config.maxGrantAgeMs) && config.maxGrantAgeMs > 0
      && Number.isSafeInteger(policy.minLength) && policy.minLength > 0
      && Number.isSafeInteger(policy.maxLength) && policy.maxLength >= policy.minLength
      && Number.isSafeInteger(policy.maxUtf8Bytes) && policy.maxUtf8Bytes >= policy.maxLength;
  } catch {
    return false;
  }
}

function validPassword(value: unknown, policy: RecoveryConfig["passwordPolicy"]): value is string {
  if (typeof value !== "string" || value.length > policy.maxUtf8Bytes) return false;
  // Reject lone UTF-16 surrogates instead of silently replacing them during encoding.
  const characters = [...value];
  if (characters.some((character) => character.length === 1 && /[\uD800-\uDFFF]/u.test(character))) return false;
  return characters.length >= policy.minLength && characters.length <= policy.maxLength
    && new TextEncoder().encode(value).length <= policy.maxUtf8Bytes;
}

export function createPasswordRecoveryService(setup?: { config: RecoveryConfig; ports: RecoveryPorts }) {
  if (setup && !validConfig(setup.config)) throw new Error("Invalid password recovery configuration");
  // Snapshot configuration so a caller cannot change trusted origin/policy mid-flow.
  const config = setup ? { ...setup.config, passwordPolicy: { ...setup.config.passwordPolicy } } : undefined;
  const ports = setup?.ports;
  const unavailable = () => result(503, "recovery_not_connected", "비밀번호 재설정은 아직 연결되지 않았어요.");
  const invalidLink = () => result(410, "recovery_invalid", "사용할 수 없는 재설정 요청이에요. 새 링크를 요청해 주세요.", true);
  const unknownChange = () => result(503, "change_unknown", "변경 여부를 확인하지 못했어요. 자동 재시도하지 말고 로그인 또는 고객지원으로 확인해 주세요.", true);
  const pending = () => result(503, "recovery_incomplete", "비밀번호는 변경됐지만 세션 정리 또는 완료 상태를 확인하지 못했어요. 고객지원에 문의해 주세요.", true);

  function audit(event: RecoveryAuditEvent) {
    try { ports?.audit?.(event); } catch { /* Observability cannot alter security state. */ }
  }

  function allowed(context: RecoveryContext): boolean {
    return context.method === "POST" && context.origin === config?.origin
      && context.csrfVerified === true && reference(context.sourceKey);
  }

  async function record(grant: RecoveryGrant, state: RecoveryState): Promise<boolean> {
    try {
      await ports!.grants.record(grant.claimId, state);
      return true;
    } catch {
      audit("state_write_failed");
      return false;
    }
  }

  return {
    async requestReset(body: unknown, context: RecoveryContext): Promise<RecoveryResult> {
      if (!config || !ports) return unavailable();
      if (!allowed(context)) return result(403, "request_denied", "허용되지 않은 요청이에요.");
      const email = exactFields(body, ["email"]) ? emailAddress(body.email) : null;
      if (!email) return result(400, "invalid_email", "올바른 이메일 주소를 입력해 주세요.");
      try {
        await ports.requests.enqueue({ email, sourceKey: context.sourceKey, redirectTo: config.origin + RECOVERY_CALLBACK_PATH });
      } catch {
        audit("request_queue_unavailable");
      }
      // Includes rate-limited, nonexistent accounts and queue failures: never claim sent.
      return result(202, "request_received", "해당 이메일로 재설정이 가능한 경우 안내를 보내드려요. 메일이 오지 않으면 잠시 후 다시 요청해 주세요.");
    },

    async resetPassword(body: unknown, context: RecoveryContext): Promise<RecoveryResult> {
      if (!config || !ports) return unavailable();
      if (!allowed(context)) return result(403, "request_denied", "허용되지 않은 요청이에요.");
      if (!exactFields(body, ["newPassword", "confirmation"]) || !validPassword(body.newPassword, config.passwordPolicy)) {
        return result(400, "invalid_password", "비밀번호가 허용된 길이 또는 형식에 맞지 않아요.");
      }
      if (body.newPassword !== body.confirmation) return result(400, "password_mismatch", "새 비밀번호가 서로 달라요.");
      if (!reference(context.recoveryHandle) || !reference(context.browserBinding)) return invalidLink();
      let grant: RecoveryGrant | null;
      let now: number;
      try {
        now = ports.now();
        if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid clock");
        grant = await ports.grants.claim({
          handle: context.recoveryHandle, browserBinding: context.browserBinding,
          sourceKey: context.sourceKey, now, issuer: config.issuer, maxGrantAgeMs: config.maxGrantAgeMs,
        });
        // A slow shared-store call must not let an already-expired grant mutate a password.
        now = ports.now();
        if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid clock");
      } catch {
        audit("grant_store_unavailable");
        return result(503, "recovery_unavailable", "재설정 요청을 확인할 수 없어요. 잠시 후 새 링크를 요청해 주세요.", true);
      }
      if (!grant) return invalidLink();
      if (grant.purpose !== "password_recovery" || grant.issuer !== config.issuer
        || !reference(grant.claimId) || !reference(grant.subject) || !reference(grant.recoverySessionId) || !reference(grant.credentialRef)
        || !Number.isSafeInteger(grant.issuedAt) || !Number.isSafeInteger(grant.expiresAt)
        || grant.issuedAt < 0 || grant.issuedAt > now || grant.expiresAt <= now
        || grant.expiresAt <= grant.issuedAt || now - grant.issuedAt >= config.maxGrantAgeMs
        || grant.expiresAt - grant.issuedAt > config.maxGrantAgeMs) {
        audit("grant_rejected");
        if (reference(grant.claimId)) await record(grant, "rejected");
        return invalidLink();
      }

      let changed: "changed" | "rejected" | "unknown" = "unknown";
      try { changed = await ports.provider.changePassword(grant, body.newPassword); } catch { /* Ambiguous provider outcome. */ }
      if (changed === "rejected") {
        await record(grant, "rejected");
        return result(400, "reset_rejected", "변경을 완료하지 못했어요. 새 링크로 다시 진행해 주세요.", true);
      }
      if (changed !== "changed") {
        audit("change_unknown");
        await record(grant, "change_unknown");
        return unknownChange();
      }

      const checkpointSaved = await record(grant, "password_changed");
      let revoked = false;
      // Even if checkpoint persistence failed, still attempt to invalidate old sessions.
      try { revoked = (await ports.provider.revokeSessions(grant)) === true; } catch { /* Retry revocation only in reconciliation. */ }
      if (!revoked) {
        audit("revocation_pending");
        await record(grant, "revocation_pending");
        return pending();
      }
      const completedSaved = await record(grant, "completed");
      if (!checkpointSaved || !completedSaved) return pending();
      return result(200, "password_reset", "비밀번호를 변경했어요. 새 비밀번호로 로그인해 주세요.", true);
    },
  };
}
