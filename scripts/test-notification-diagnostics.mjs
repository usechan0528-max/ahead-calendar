// Isolated state/component checks: no browser, live API, or real notifications.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const cache = new Map();
async function moduleUrl(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  let source = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const match of [...source.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    const specifier = match[1];
    let url;
    if (specifier.startsWith('.') || specifier.startsWith('@/')) {
      const base = specifier.startsWith('@/') ? path.resolve(specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
      let target = `${base}.ts`;
      try { await readFile(target); } catch { target = `${base}.tsx`; }
      url = await moduleUrl(target);
    } else url = pathToFileURL(require.resolve(specifier)).href;
    source = source.replace(match[0], `from '${url}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  cache.set(file, url); return url;
}
const lib = await import(await moduleUrl('lib/notification-diagnostics.ts'));
const { notificationDiagnosis: diagnose, browserPlatform, matchingPushDevice, serverCheck, withPushTimeout } = lib;
const ready = { browser: { platform: 'desktop', standalone: false, secure: true, online: true, supported: true }, permission: 'granted', device: { id: 7, enabled: true }, deviceState: 'ready', server: 'ready' };
assert.equal(diagnose(ready).tone, 'good');
assert.equal(diagnose({ ...ready, browser: null }).tone, 'neutral');
for (const change of [{ secure: false }, { online: false }, { supported: false }, { platform: 'ios', standalone: false }]) assert.notEqual(diagnose({ ...ready, browser: { ...ready.browser, ...change } }).tone, 'good');
assert.equal(diagnose({ ...ready, browser: { ...ready.browser, platform: 'ios', standalone: true } }).tone, 'good');
for (const permission of ['default', 'denied']) assert.notEqual(diagnose({ ...ready, permission }).tone, 'good');
for (const server of ['checking', 'delayed', 'unconfigured', 'signed-out', 'error']) assert.notEqual(diagnose({ ...ready, server }).tone, 'good');
for (const device of [null, { id: 7, enabled: false }]) assert.equal(diagnose({ ...ready, device }).action, 'enable');
assert.equal(diagnose({ ...ready, deviceState: 'error' }).action, 'retry');
assert.equal(browserPlatform('Mozilla Macintosh', 5), 'ios');
assert.equal(browserPlatform('Mozilla Macintosh', 0), 'desktop');
assert.equal(browserPlatform('Mozilla iPhone'), 'ios');
assert.equal(browserPlatform('Mozilla Android'), 'android');
assert.deepEqual(matchingPushDevice({ subscriptions: [{ id: 7, endpoint: 'mine', disabled_at: null, reminders_enabled_at: 'date' }] }, 'mine'), { id: 7, enabled: true });
assert.equal(matchingPushDevice({ subscriptions: [{ id: 7, endpoint: 'another', disabled_at: null }] }, 'mine'), null);
assert.equal(matchingPushDevice({ subscriptions: [{ id: 7, endpoint: 'mine', disabled_at: 'date' }] }, 'mine'), null);
assert.deepEqual(matchingPushDevice({ subscriptions: [{ id: 7, endpoint: 'mine', disabled_at: null, reminders_enabled_at: null }] }, 'mine'), { id: 7, enabled: false });
assert.throws(() => matchingPushDevice({}, 'mine'));
assert.throws(() => matchingPushDevice({ subscriptions: [{ id: 0, endpoint: 'mine', disabled_at: null }] }, 'mine'));
assert.equal(serverCheck(401, {}), 'signed-out'); assert.equal(serverCheck(503, {}), 'unconfigured');
assert.equal(serverCheck(200, {}), 'error'); assert.equal(serverCheck(500, { scheduler: { ready: true } }), 'error');
assert.equal(serverCheck(200, { scheduler: { ready: false } }), 'delayed');
assert.equal(await withPushTimeout(Promise.resolve(42), 10), 42);
await assert.rejects(withPushTimeout(new Promise(() => {}), 5), /오래 걸리고/);
console.log('PASS: diagnostic status matrix, iPad detection, account-scoped device matching and bounded waits');

const { NotificationDiagnostics } = await import(await moduleUrl('components/notification-diagnostics.tsx'));
const props = { ...ready, busy: false, refreshing: false, checkedAt: null, error: null, events: [{ id: 1, title: '내 테스트 일정' }], eventsReady: true, latestTest: null, onRefresh() {}, onToggle() {}, onTest() {}, onCreate() {}, onTestDetails() {} };
const markup = renderToStaticMarkup(createElement(NotificationDiagnostics, props));
for (const label of ['알림 상태 점검', '알림 권한', '이 기기의 일정 수신', '자동 발송 서버', '약 2분 뒤 테스트 예약', '실제 수신 확인과 달라요', '인터넷 연결이 필요해요', '홈 화면에 추가']) assert.ok(markup.includes(label));
assert.match(markup, /for="diagnostic-test-event"/);
assert.match(markup, /for="install-platform"/);
assert.doesNotMatch(markup, />J에게 설치하기</, 'No install button without an actual browser prompt.');
assert.match(renderToStaticMarkup(createElement(NotificationDiagnostics, { ...props, events: [] })), /첫 일정 만들기/);
assert.doesNotMatch(renderToStaticMarkup(createElement(NotificationDiagnostics, { ...props, events: [] })), /<select id="diagnostic-test-event"/);
assert.match(renderToStaticMarkup(createElement(NotificationDiagnostics, { ...props, error: '테스트 실패' })), /role="alert"/);
assert.match(renderToStaticMarkup(createElement(NotificationDiagnostics, { ...props, latestTest: { title: '내 테스트', status: '예약됨', detail: '예약됨', scheduledFor: '내일' }, testWarning: '조회 실패' })), /조회 실패.*테스트 기록 다시 조회/);
assert.match(renderToStaticMarkup(createElement(NotificationDiagnostics, { ...props, browser: { ...ready.browser, platform: 'ios', standalone: false, supported: false } })), /id="mobile-install-guide"[^>]*open=""/);
console.log('PASS: accessible status/error/test/empty/install guidance rendering');

// Lightweight hook harness with controllable responses/timers. It deliberately ignores
// AbortSignal in mocked fetch to prove stale reads cannot overwrite a newer state.
const hookSource = ts.transpileModule(await readFile('components/use-notification-diagnostics.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function eventTarget(extra = {}) {
  const listeners = new Map();
  return { ...extra, addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); }, removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }, emit(type) { for (const fn of listeners.get(type) ?? []) fn(); } };
}
function harness() {
  const slots = []; let cursor = 0; let pending = []; const timers = new Map(); let timerId = 0;
  const frames = new Map(); const writes = []; let subscription = { endpoint: 'mine', expirationTime: null };
  let responder = async url => ({ status: 200, ok: true, json: async () => url.includes('public-key') ? { scheduler: { ready: true } } : { subscriptions: [{ id: 7, endpoint: 'mine', disabled_at: null, reminders_enabled_at: 'date' }] } });
  const notification = { permission: 'granted' };
  const navigator = { userAgent: 'desktop', maxTouchPoints: 0, onLine: true, serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription } }) } };
  const window = eventTarget({ isSecureContext: true, Notification: notification, PushManager: {}, matchMedia: () => eventTarget({ matches: false }), setInterval: () => 1, clearInterval() {}, setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id), requestAnimationFrame: fn => { const id = ++timerId; frames.set(id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id) });
  const document = eventTarget({ visibilityState: 'visible' });
  const equal = (a, b) => a && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(fn, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) slots[index] = { fn, deps }; return slots[index].fn; },
    useEffect(fn, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) { pending.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; }); } },
  };
  const exports = {};
  runInNewContext(hookSource, { exports, require: name => name === 'react' ? react : lib, window, navigator, document, Notification: notification, AbortController, Date, fetch: (url, options) => { writes.push({ url, options }); return responder(url, options); } });
  function render(busy = false) { cursor = 0; const value = exports.useNotificationDiagnostics(busy); const work = pending; pending = []; work.forEach(fn => fn()); return value; }
  return { render, window, document, notification, navigator, writes, frames, timers, setResponder: fn => { responder = fn; }, setSubscription: value => { subscription = value; } };
}
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const h = harness();
h.render(); for (const fn of h.frames.values()) fn(); h.frames.clear(); await settle();
assert.equal(h.render().server, 'ready'); assert.equal(h.render().device.enabled, true);
assert.ok(h.writes.every(write => !write.options.method), 'Inspection never posts, enables or requests permission.');
h.notification.permission = 'denied'; h.window.emit('focus'); await settle(); assert.equal(h.render().permission, 'denied');
h.notification.permission = 'granted'; h.document.emit('visibilitychange'); await settle(); assert.equal(h.render().permission, 'granted');
h.setSubscription({ endpoint: 'mine', expirationTime: Date.now() - 1 }); await h.render().refresh(); assert.equal(h.render().device, null);
h.setSubscription({ endpoint: 'mine', expirationTime: null });
h.setResponder(async () => { throw new Error('Network'); }); await h.render().refresh(); assert.equal(h.render().deviceState, 'error'); assert.equal(h.render().server, 'error');
h.setResponder(async () => ({ status: 401, ok: false, json: async () => ({}) })); await h.render().refresh(); assert.equal(h.render().server, 'signed-out');
const waiting = []; h.setResponder(() => new Promise(resolve => waiting.push(resolve)));
const oldRead = h.render().refresh(); await settle();
h.render().cancelReads(); h.render().setDevice({ id: 7, enabled: false }); h.render(true);
waiting.forEach(resolve => resolve({ ok: true, status: 200, json: async () => ({ scheduler: { ready: true }, subscriptions: [{ id: 7, endpoint: 'mine', disabled_at: null, reminders_enabled_at: 'date' }] }) }));
await oldRead; assert.equal(h.render(true).device.enabled, false, 'An older read cannot restore enabled after a mutation.');
const timeoutHarness = harness(); timeoutHarness.setResponder(() => new Promise(() => {}));
timeoutHarness.render(); for (const fn of timeoutHarness.frames.values()) fn(); await settle();
for (const fn of timeoutHarness.timers.values()) fn();
assert.equal(timeoutHarness.render().server, 'error'); assert.equal(timeoutHarness.render().refreshing, false);
const stable = harness();
assert.equal(stable.render().deviceState, 'checking', 'The first inspection still has a real loading state.');
for (const fn of stable.frames.values()) fn(); stable.frames.clear(); await settle();
const lastCheck = stable.render().checkedAt;
const failures = []; stable.setResponder(() => new Promise((_, reject) => failures.push(reject)));
const refreshRead = stable.render().refresh(); await settle();
assert.equal(stable.render().refreshing, true);
assert.equal(stable.render().deviceState, 'ready'); assert.equal(stable.render().server, 'ready');
assert.equal(stable.render().checkedAt, lastCheck, 'A pending refresh must not claim a newer successful check.');
assert.equal(diagnose(stable.render()).tone, 'good', 'Background refresh keeps the last diagnosis instead of flashing a loading card.');
failures.forEach(reject => reject(new Error('Network'))); await refreshRead;
assert.equal(stable.render().deviceState, 'error'); assert.equal(stable.render().server, 'error');
assert.equal(stable.render().refreshing, false, 'New failures still replace the previous healthy state.');
console.log('PASS: permission refresh, expired subscriptions, failures, timeouts, read-only checks and mutation race fence');

const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
assert.equal(manifest.display, 'standalone'); assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/');
for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const png = await readFile(`public/${file}`); assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
}
const layout = await readFile('app/layout.tsx', 'utf8'); assert.match(layout, /rel="manifest" href="\/manifest.webmanifest" crossOrigin="use-credentials"/); assert.match(layout, /apple: '\/apple-touch-icon.png'/);
const homepage = await readFile('app/page.tsx', 'utf8');
assert.match(homepage, /workspaceView === 'notifications' && !detailOpen && current && current.job.id !== job\?\.id \? current/);
assert.match(homepage, /pushBusyRef.current \|\| isSchedulingPush/);
assert.match(homepage, /diagnostics.cancelReads\(\)/);
assert.match(homepage, /withPushTimeout\(navigator.serviceWorker.ready\)/);
const sw = await readFile('public/sw.js', 'utf8'); assert.doesNotMatch(sw, /caches\.open|addEventListener\(['"]fetch/);
console.log('PASS: install manifest/icon dimensions, test-selection preservation and no offline-cache claim');
