import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../lib/auth/password-recovery.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { createPasswordRecoveryService, RECOVERY_CALLBACK_PATH } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const config = {
  origin: "https://scheduler.example", issuer: "https://auth.example/auth/v1",
  maxGrantAgeMs: 600_000, passwordPolicy: { minLength: 15, maxLength: 128, maxUtf8Bytes: 512 },
};
const context = {
  method: "POST", origin: config.origin, csrfVerified: true, sourceKey: "server-source-key",
  recoveryHandle: "server-grant-handle", browserBinding: "server-cookie-binding",
};
const password = "  My new password 한글 🔒  ";
const body = { newPassword: password, confirmation: password };

// In-memory fake only. This is NOT an implementation of a shared production store.
function fixture(options = {}) {
  const fixtureConfig = { ...config, passwordPolicy: { ...config.passwordPolicy, ...options.passwordPolicy } };
  const events = [], jobs = [], states = [], changes = [];
  let claimed = false, revocations = 0, claims = 0;
  const grant = {
    claimId: "claim-1", issuer: config.issuer, subject: "provider-user-1", recoverySessionId: "verified-recovery-1",
    purpose: "password_recovery", issuedAt: 1_000, expiresAt: 601_000, credentialRef: "private-provider-credential-ref",
    ...options.grant,
  };
  const ports = {
    now: () => typeof options.now === "function" ? options.now() : options.now ?? 2_000,
    requests: { async enqueue(job) {
      if (options.queueError) throw new Error("secret provider error");
      if (!options.suppressed) jobs.push(job);
    } },
    grants: {
      async claim(input) {
        claims++;
        assert.equal(input.issuer, config.issuer);
        assert.equal(input.maxGrantAgeMs, config.maxGrantAgeMs);
        if (options.claimError) throw new Error("secret store error");
        if (claimed || options.noGrant || input.handle !== context.recoveryHandle || input.browserBinding !== context.browserBinding) return null;
        // No await between read and write, modelling the required atomic transition.
        claimed = true;
        return grant;
      },
      async record(claimId, state) {
        assert.equal(claimId, grant.claimId);
        if (options.recordError === state || options.recordError === true) throw new Error("secret persistence error");
        states.push(state);
      },
    },
    provider: {
      async changePassword(proof, suppliedPassword) {
        assert.equal(proof, grant);
        changes.push(suppliedPassword);
        if (options.changeError) throw new Error("secret provider timeout");
        return options.changeResult ?? "changed";
      },
      async revokeSessions(proof) {
        assert.equal(proof, grant);
        revocations++;
        if (options.revokeError) throw new Error("secret revocation error");
        return options.revoked ?? true;
      },
    },
    audit(event) { events.push(event); if (options.auditError) throw new Error("secret audit error"); },
  };
  return {
    service: createPasswordRecoveryService({ config: fixtureConfig, ports }), events, jobs, states, changes,
    get revocations() { return revocations; }, get claims() { return claims; },
  };
}

test("disconnected service never sends mail or changes passwords", async () => {
  const service = createPasswordRecoveryService();
  assert.equal((await service.requestReset({ email: "person@example.com" }, context)).code, "recovery_not_connected");
  assert.equal((await service.resetPassword(body, context)).status, 503);
});

test("rejects unsafe callback configuration and snapshots trusted configuration", async () => {
  for (const origin of ["http://scheduler.example", "https://scheduler.example/", "https://scheduler.example/path", "https://user:pass@scheduler.example", "https://scheduler.example?next=bad"]) {
    assert.throws(() => createPasswordRecoveryService({ config: { ...config, origin }, ports: {} }));
  }
  const mutable = structuredClone(config), jobs = [];
  const service = createPasswordRecoveryService({ config: mutable, ports: { requests: { enqueue: async (job) => jobs.push(job) } } });
  mutable.origin = "https://attacker.example";
  await service.requestReset({ email: "person@example.com" }, context);
  assert.equal(jobs[0].redirectTo, config.origin + RECOVERY_CALLBACK_PATH);
});

test("normalizes only case and surrounding spaces; preserves plus tags and dots", async () => {
  const f = fixture();
  assert.equal((await f.service.requestReset({ email: "  Person.Name+J@Example.COM  " }, context)).status, 202);
  assert.deepEqual(f.jobs, [{ email: "person.name+j@example.com", sourceKey: context.sourceKey, redirectTo: config.origin + RECOVERY_CALLBACK_PATH }]);
});

test("identical public response for queued, suppressed, and failing requests", async () => {
  const results = [];
  for (const options of [{}, { suppressed: true }, { queueError: true }, { queueError: true, auditError: true }]) {
    results.push(await fixture(options).service.requestReset({ email: "person@example.com" }, context));
  }
  for (const response of results) assert.deepEqual(response, results[0]);
  assert.doesNotMatch(JSON.stringify(results), /secret|person@example/);
});

test("both operations require POST, exact Origin, server CSRF and source key", async () => {
  for (const patch of [{ method: "GET" }, { origin: null }, { origin: "null" }, { origin: config.origin + ".attacker.example" }, { csrfVerified: false }, { sourceKey: "" }]) {
    const f = fixture(), ctx = { ...context, ...patch };
    assert.equal((await f.service.requestReset({ email: "person@example.com" }, ctx)).status, 403);
    assert.equal((await f.service.resetPassword(body, ctx)).status, 403);
    assert.equal(f.jobs.length + f.claims + f.changes.length, 0);
  }
});

test("invalid email and extra identity/redirect fields do not enqueue", async () => {
  for (const input of [null, [], {}, { email: "a@" }, { email: "a\r\n@example.com" }, { email: ".a@example.com" }, { email: "a..b@example.com" }, { email: "a".repeat(65) + "@example.com" }, { email: "person@example.com", redirectTo: "https://evil.example" }, { email: "person@example.com", ownerId: "victim" }]) {
    const f = fixture();
    assert.equal((await f.service.requestReset(input, context)).status, 400);
    assert.equal(f.jobs.length, 0);
  }
});

test("password validation precedes claim; no truncation or implicit confirmation", async () => {
  for (const input of [null, { newPassword: password }, { ...body, confirmation: "different" }, { ...body, subject: "victim" }, { newPassword: "short", confirmation: "short" }, { newPassword: "a".repeat(129), confirmation: "a".repeat(129) }, { newPassword: "a".repeat(16) + "\uD800", confirmation: "a".repeat(16) + "\uD800" }]) {
    const f = fixture();
    assert.equal((await f.service.resetPassword(input, context)).status, 400);
    assert.equal(f.claims, 0);
  }
});

test("successful reset preserves whitespace/Unicode and revokes sessions before success", async () => {
  const f = fixture();
  const response = await f.service.resetPassword(body, context);
  assert.equal(response.code, "password_reset");
  assert.equal(response.clearRecoveryCookie, true);
  assert.deepEqual(f.changes, [password]);
  assert.deepEqual(f.states, ["password_changed", "completed"]);
  assert.equal(f.revocations, 1);
  assert.doesNotMatch(JSON.stringify(response), /credential|provider-user|server-grant|My new/);
});

test("enforces UTF-8 byte limits independently of character length", async () => {
  for (const newPassword of ["한".repeat(50), "🔒".repeat(40)]) {
    const f = fixture({ passwordPolicy: { maxUtf8Bytes: 128 } });
    assert.equal((await f.service.resetPassword({ newPassword, confirmation: newPassword }, context)).code, "invalid_password");
    assert.equal(f.claims, 0);
  }
  const newPassword = "한".repeat(15), f = fixture({ passwordPolicy: { maxUtf8Bytes: 128 } });
  assert.equal((await f.service.resetPassword({ newPassword, confirmation: newPassword }, context)).status, 200);
  assert.deepEqual(f.changes, [newPassword]);
});

test("missing, mismatched and normal-login grants cannot reset passwords", async () => {
  for (const options of [{ noGrant: true }, { grant: { purpose: "login" } }, { grant: { issuer: "https://other.example" } }, { grant: { subject: "" } }, { grant: { recoverySessionId: "" } }, { grant: { credentialRef: "" } }]) {
    const f = fixture(options);
    assert.equal((await f.service.resetPassword(body, context)).status, 410);
    assert.equal(f.changes.length, 0);
  }
  for (const patch of [{ recoveryHandle: undefined }, { browserBinding: "wrong-binding" }, { recoveryHandle: "wrong-handle" }]) {
    const f = fixture();
    assert.equal((await f.service.resetPassword(body, { ...context, ...patch })).status, 410);
    assert.equal(f.changes.length, 0);
  }
});

test("rejects expired, future, overly long-lived, and malformed grants", async () => {
  for (const grant of [{ expiresAt: 2_000 }, { issuedAt: 2_001 }, { issuedAt: -1 }, { expiresAt: Number.NaN }, { expiresAt: 601_001 }, { issuedAt: 1_999, expiresAt: 1_998 }]) {
    const f = fixture({ grant });
    assert.equal((await f.service.resetPassword(body, context)).status, 410);
    assert.equal(f.changes.length, 0);
  }
  const f = fixture({ now: 601_000 });
  assert.equal((await f.service.resetPassword(body, context)).status, 410);
});

test("20 concurrent submissions and subsequent replay cause one mutation", async () => {
  const f = fixture();
  const responses = await Promise.all(Array.from({ length: 20 }, () => f.service.resetPassword(body, context)));
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal(f.changes.length, 1);
  assert.equal(f.revocations, 1);
  assert.equal((await f.service.resetPassword(body, context)).status, 410);
});

test("rechecks expiry after a slow grant claim", async () => {
  let clockReads = 0;
  const f = fixture({ now: () => clockReads++ === 0 ? 2_000 : 601_000 });
  assert.equal((await f.service.resetPassword(body, context)).status, 410);
  assert.equal(f.changes.length, 0);
});

test("provider timeout/unknown outcome closes claim and never retries password update", async () => {
  for (const options of [{ changeError: true }, { changeResult: "unknown" }, { changeError: true, recordError: true }]) {
    const f = fixture(options);
    assert.equal((await f.service.resetPassword(body, context)).code, "change_unknown");
    assert.equal((await f.service.resetPassword(body, context)).status, 410);
    assert.equal(f.changes.length, 1);
    assert.equal(f.revocations, 0);
    assert.ok(f.events.includes("change_unknown"));
    assert.doesNotMatch(JSON.stringify(f.events), /secret|provider-user|My new/);
  }
});

test("definitive provider rejection is not success and does not reopen claim", async () => {
  const f = fixture({ changeResult: "rejected" });
  assert.equal((await f.service.resetPassword(body, context)).code, "reset_rejected");
  assert.deepEqual(f.states, ["rejected"]);
  assert.equal((await f.service.resetPassword(body, context)).status, 410);
  assert.equal(f.changes.length, 1);
});

test("revocation and state-write failures report partial completion without reapplying password", async () => {
  for (const options of [{ revoked: false }, { revokeError: true }, { recordError: "password_changed" }, { recordError: "completed" }, { recordError: true }]) {
    const f = fixture(options);
    assert.equal((await f.service.resetPassword(body, context)).code, "recovery_incomplete");
    assert.equal(f.revocations, 1);
    assert.equal((await f.service.resetPassword(body, context)).status, 410);
    assert.equal(f.changes.length, 1);
  }
});

test("store failure or invalid clock fails closed without exposing errors", async () => {
  for (const options of [{ claimError: true }, { now: -1 }, { now: Number.NaN }]) {
    const f = fixture(options);
    const response = await f.service.resetPassword(body, context);
    assert.equal(response.code, "recovery_unavailable");
    assert.equal(f.changes.length, 0);
    assert.doesNotMatch(JSON.stringify(response), /secret/);
  }
});
