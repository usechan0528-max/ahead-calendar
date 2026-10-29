// No real browser, user data or network traffic. Actual-device QA remains separate.
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
const lib = await import(await moduleUrl('lib/mobile-viewport.ts'));
const { mobileViewport } = lib;
assert.deepEqual(mobileViewport({ layoutHeight: 844, height: 480, offsetTop: 32, scale: 1, editing: true }), { height: 480, top: 32, keyboard: true });
assert.equal(mobileViewport({ layoutHeight: 844, height: 480, offsetTop: 0, scale: 1, editing: false }).keyboard, false);
assert.equal(mobileViewport({ layoutHeight: 844, height: 420, offsetTop: 0, scale: 2, editing: true }), null, 'Zoom is not a keyboard.');
assert.equal(mobileViewport({ layoutHeight: 844, height: 800, offsetTop: 0, scale: 1, editing: true }).keyboard, false, 'Browser chrome is not a keyboard.');
assert.deepEqual(mobileViewport({ layoutHeight: 390, height: 390, offsetTop: 999, scale: 1, editing: true }), { height: 390, top: 0, keyboard: false });
assert.equal(mobileViewport({ layoutHeight: 0, height: 400, offsetTop: 0, scale: 1, editing: true }), null);
assert.equal(mobileViewport({ layoutHeight: 844, height: NaN, offsetTop: 0, scale: 1, editing: true }), null);
const { MobileNavigation } = await import(await moduleUrl('components/mobile-navigation.tsx'));
function elements(node) { if (Array.isArray(node)) return node.flatMap(elements); return node && typeof node === 'object' && node.props ? [node, ...elements(node.props.children)] : []; }
const moves = []; let creates = 0;
const dockProps = { view: 'calendar', detailOpen: false, hidden: false, onNavigate: view => moves.push(view), onCreate: () => creates++ };
const dock = MobileNavigation(dockProps);
const buttons = elements(dock).filter(node => node.type === 'button');
assert.equal(buttons.length, 5); assert.equal(buttons[2].props['aria-label'], '새 일정 추가');
assert.ok(buttons.every(button => button.props.children[0].props.className.includes('mobile-navigation-icon')), 'Every dock icon uses the same height slot.');
assert.equal(buttons[2].props.children[1].props.children, '추가', 'The narrow center label stays compact without losing its accessible name.');
buttons[2].props.onClick(); assert.equal(creates, 1); assert.deepEqual(moves, []);
buttons[3].props.onClick(); assert.deepEqual(moves, ['preparations']);
assert.equal(buttons.filter(node => node.props['aria-current'] === 'page').length, 1);
assert.ok(elements(MobileNavigation({ ...dockProps, detailOpen: true })).every(node => !node.props['aria-current']));
assert.match(renderToStaticMarkup(createElement(MobileNavigation, { ...dockProps, hidden: true })), /<nav[^>]+hidden=""/);
const { EventEditorDialog } = await import(await moduleUrl('components/event-editor-dialog.tsx'));
const dialog = renderToStaticMarkup(createElement(EventEditorDialog, { title: '새 일정 추가', isSaving: false, isOffline: true, error: '저장 오류 안내', onClose() {}, onSubmit() {}, footer: createElement('button', { type: 'submit', disabled: true }, '인터넷 연결 후 저장') }, createElement('input', { name: 'title', defaultValue: '작성 중인 일정' })));
assert.match(dialog, /class="event-editor-toolbar"/); assert.match(dialog, /class="event-editor-scroll"/); assert.match(dialog, /class="event-editor-footer"/);
assert.match(dialog, /role="status"/); assert.match(dialog, /작성 중인 일정/); assert.doesNotMatch(dialog, /<fieldset[^>]+disabled/);
assert.match(dialog, /<button type="submit" disabled="">인터넷 연결 후 저장/);
assert.ok(dialog.indexOf('저장 오류 안내') > dialog.indexOf('class="event-editor-footer"'), 'Save errors stay visible alongside the fixed action, outside the scrolled content.');
assert.match(dialog, /class="event-editor-error" role="alert"/);
console.log('PASS: keyboard/zoom/orientation sizing, five-button dock actions, selected/hidden navigation and offline editable form');

function target(extra = {}) {
  const listeners = new Map();
  return { ...extra, listeners, addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); }, removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }, emit(type) { for (const fn of listeners.get(type) ?? []) fn(); } };
}
const properties = new Map(); const attributes = new Set(); const frames = new Map(); let frameId = 0; let cleanup; let resizeObserver;
const root = { style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) }, toggleAttribute: (key, active) => active ? attributes.add(key) : attributes.delete(key), removeAttribute: key => attributes.delete(key) };
let dockHeight = 110;
const dockElement = { getBoundingClientRect: () => ({ height: dockHeight }) };
class Input { matches() { return true; } }
const viewport = target({ height: 480, offsetTop: 0, scale: 1 });
const window = target({ innerHeight: 844, visualViewport: viewport, requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id) });
const document = target({ documentElement: root, activeElement: new Input(), querySelector: () => dockElement });
const exports = {};
const source = ts.transpileModule(await readFile('components/use-mobile-viewport.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
runInNewContext(source, { exports, require: name => name === 'react' ? { useEffect: fn => { cleanup = fn(); } } : lib, window, document, HTMLElement: Input, ResizeObserver: class { constructor(fn) { resizeObserver = { fn }; } observe(node) { resizeObserver.node = node; } disconnect() { resizeObserver.disconnected = true; } } });
const flush = () => { const work = [...frames.values()]; frames.clear(); work.forEach(fn => fn()); };
exports.useMobileViewport(); flush();
assert.equal(properties.get('--app-visible-height'), '480px'); assert.ok(attributes.has('data-mobile-keyboard'));
resizeObserver.fn([{ target: dockElement }]); assert.equal(properties.get('--mobile-dock-height'), '110px');
dockHeight = 0; resizeObserver.fn([{ target: dockElement }]); assert.equal(properties.get('--mobile-dock-height'), '110px');
viewport.scale = 2; viewport.emit('resize'); flush(); assert.ok(!attributes.has('data-mobile-keyboard')); assert.ok(!properties.has('--app-visible-height'));
viewport.scale = 1; viewport.height = 844; document.activeElement = null; document.emit('focusout'); flush(); assert.ok(!attributes.has('data-mobile-keyboard'));
viewport.height = 390; window.innerHeight = 390; window.emit('resize'); flush(); assert.equal(properties.get('--app-visible-height'), '390px');
cleanup(); assert.equal(properties.size, 0); assert.ok(resizeObserver.disconnected); assert.ok([...viewport.listeners.values()].every(set => set.size === 0));
console.log('PASS: visual viewport events, keyboard dismissal, pinch zoom, rotated layout, measured dock and cleanup');

// Connection status is independent of notification mutations and never submits data.
const connectionSource = ts.transpileModule(await readFile('components/use-connection-status.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const onlineWindow = target(); const navigator = { onLine: false }; let unsubscribe; let updates = 0; const connectionExports = {};
runInNewContext(connectionSource, { exports: connectionExports, window: onlineWindow, navigator, require: () => ({ useSyncExternalStore: (subscribe, snapshot, serverSnapshot) => { assert.equal(serverSnapshot(), true); unsubscribe = subscribe(() => updates++); return snapshot(); } }) });
assert.equal(connectionExports.useConnectionStatus(), false); onlineWindow.emit('online'); onlineWindow.emit('offline'); assert.equal(updates, 2); unsubscribe(); onlineWindow.emit('online'); assert.equal(updates, 2);
const home = await readFile('app/page.tsx', 'utf8');
assert.match(home, /const isOffline = !useConnectionStatus\(\)/); assert.match(home, /if \(!navigator.onLine\).*setSaveError/);
assert.match(home, /<main[^>]+inert=\{modalOpen\}/); assert.match(home, /<MobileNavigation[^>]+hidden=\{modalOpen\}/);
const css = await readFile('app/globals.css', 'utf8'); const layout = await readFile('app/layout.tsx', 'utf8');
for (const edge of ['top', 'right', 'bottom', 'left']) assert.ok(css.includes(`safe-area-inset-${edge}`));
assert.ok(css.includes('calc(var(--mobile-dock-height) + 24px)')); assert.ok(css.includes('[data-mobile-keyboard] .mobile-navigation'));
assert.match(layout, /viewportFit: 'cover'/); assert.doesNotMatch(layout, /maximumScale|userScalable/);
console.log('PASS: independent connection events, explicit-only saving, background inertness, safe-area and zoom contract');
