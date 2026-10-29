// Run after Wrangler's dry-run build of infra/scheduler/wrangler.jsonc.
// All network traffic is mocked; no production credentials are used.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { Miniflare, createFetchMock } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
const origin = 'https://ahead-calendar-kr-prototype.dldydcks0528.chatgpt.site';
for (const [label, statusCode, contentType, data, expected] of [
  ['authenticated completion', 200, 'application/json', '{"ok":true}', 'ok'],
  ['redirect rejected', 302, 'text/html', '', 'exception'],
  ['HTML login page rejected', 200, 'text/html', '<html>Login</html>', 'exception'],
  ['incomplete result rejected', 200, 'application/json', '{"ok":false}', 'exception'],
  ['server error rejected', 503, 'application/json', '{}', 'exception'],
]) {
  const mock = createFetchMock();
  mock.disableNetConnect();
  let calls = 0;
  let mockError;
  mock.get(origin).intercept({ method: 'POST', path: '/api/internal/notifications/run-due' }).reply((request) => {
    calls++;
    try {
      const input = request.headers;
      const headers = new Headers(Array.isArray(input) && typeof input[0] === 'string'
        ? Array.from({ length: input.length / 2 }, (_, index) => [input[index * 2], input[index * 2 + 1]]) : input);
      assert.equal(headers.get('oai-sites-authorization'), 'Bearer fake-test-token');
      assert.match(headers.get('x-ahead-signature'), /^[0-9a-f]{64}$/);
      assert.match(headers.get('x-ahead-timestamp'), /^\d{13}$/);
    } catch (error) { mockError = error; throw error; }
    return { statusCode, data, responseOptions: { headers: { 'content-type': contentType, location: 'https://not-allowed.example/' } } };
  });
  const mf = new Miniflare({
    modules: true, scriptPath: path.resolve('outputs/scheduler-build/worker.js'),
    compatibilityDate: '2026-05-15', fetchMock: mock,
    bindings: { SCHEDULER_SECRET: randomBytes(32).toString('base64url'), SITES_BEARER_TOKEN: 'fake-test-token' },
  });
  try {
    const worker = await mf.getWorker();
    assert.equal((await mf.dispatchFetch('http://localhost/')).status, 404);
    const result = await worker.scheduled({ cron: '* * * * *' });
    if (mockError) throw mockError;
    assert.equal(result.outcome, expected, `${label}, outbound calls: ${calls}`);
    assert.equal(calls, 1);
    console.log(`PASS: ${label}`);
  } finally {
    await mf.dispose();
    await mock.close();
  }
}
