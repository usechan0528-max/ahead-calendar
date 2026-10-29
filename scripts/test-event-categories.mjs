// Isolated component/state checks. No browser or production data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const cache = new Map();
async function moduleUrl(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  let source = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const match of [...source.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    const specifier = match[1]; let url;
    if (specifier.startsWith('.') || specifier.startsWith('@/')) {
      const base = specifier.startsWith('@/') ? path.resolve(specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
      let target = `${base}.ts`; try { await readFile(target); } catch { target = `${base}.tsx`; }
      url = await moduleUrl(target);
    } else url = pathToFileURL(require.resolve(specifier)).href;
    source = source.replace(match[0], `from '${url}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  cache.set(file, url); return url;
}
const categoryLib = await import(await moduleUrl('lib/event-category.ts'));
const { parseEventCategory, eventCategoryOptions, PRESET_CATEGORIES } = categoryLib;
const themeLib = await import(await moduleUrl('lib/design-tokens.ts'));
const { getCategoryTheme, categoryTheme, parseCategoryColor, CATEGORY_PALETTE } = themeLib;
const { parseEventInput } = await import(await moduleUrl('lib/event-input.ts'));
const base = { title: '내 계획', category: '일정', eventDate: '2030-09-10', eventTime: '09:00', recurrence: 'none' };
for (const label of [...PRESET_CATEGORIES, '공부', '전체', '생일', '결혼기념일', '__proto__', 'constructor', 'toString', '가'.repeat(20), '🏃 운동']) {
  assert.equal(parseEventCategory(label), label);
  assert.equal(parseEventInput({ ...base, category: label }).category, label);
  assert.ok(getCategoryTheme(label).accent && getCategoryTheme(label).soft);
}
assert.equal(parseEventCategory('  업무   회의  '), '업무 회의');
assert.equal(parseEventCategory('공부'.normalize('NFD')), '공부');
for (const value of [null, undefined, {}, [], 3, false, '', '   ', '\u200b', '\n공부', '가'.repeat(21)]) {
  assert.equal(parseEventCategory(value), null); assert.equal(parseEventInput({ ...base, category: value }), null);
}
assert.ok(CATEGORY_PALETTE.some(item => item.color === getCategoryTheme('__proto__').accent));
assert.equal(new Set(Object.values(categoryTheme).map(theme => theme.accent)).size, 4);
assert.equal(parseCategoryColor('#A1B2C3'), '#a1b2c3');
for (const invalid of ['red', '#abc', '#12345678', 'url(test)', '', {}, null]) assert.equal(parseCategoryColor(invalid), null);
const luminance = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
for (const color of ['#ffffff', '#000000', '#ffff00', '#00ff00', '#ff00ff', ...CATEGORY_PALETTE.map(item => item.color)]) {
  const theme = getCategoryTheme('공부', color);
  assert.equal(theme.accent, color);
  assert.ok((luminance(theme.soft) + .05) / (luminance(theme.text) + .05) >= 4.5, `${color} soft background contrast`);
  assert.ok(1.05 / (luminance(theme.text) + .05) >= 4.5, `${color} white background contrast`);
}
assert.deepEqual(eventCategoryOptions(['공부', ' 공부 ', '전체', '기념일', '공부'.normalize('NFD')]), [...PRESET_CATEGORIES, '공부', '전체']);
const { EventCategoryField } = await import(await moduleUrl('components/event-category-field.tsx'));
for (const value of ['공부', '생일', '전체', 'constructor']) {
  const markup = renderToStaticMarkup(createElement(EventCategoryField, { value, onChange() {} }));
  assert.match(markup, /name="categoryChoice" checked="" value="custom"/);
  assert.ok(markup.includes(`name="category" value="${value}"`));
  assert.match(markup, /required="" maxLength="20" pattern="\.\*\\S\.\*"/);
}
assert.doesNotMatch(renderToStaticMarkup(createElement(EventCategoryField, { value: '일정', onChange() {} })), /name="categoryCustom"/);
const escaped = renderToStaticMarkup(createElement(EventCategoryField, { value: '<script>', onChange() {} }));
assert.doesNotMatch(escaped, /<script>/); assert.match(escaped, /&lt;script&gt;/);

function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); return node?.props ? [node, ...nodes(node.props.children)] : []; }
async function harness(file, dependencies) {
  const slots = []; let cursor = 0;
  const react = { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useMemo(fn) { return fn(); } };
  const exports = {};
  const source = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(source, { exports, require: name => name === 'react' ? react : dependencies[name] ?? require(name) });
  return (name, props) => { cursor = 0; return exports[name](props); };
}
const field = await harness('components/event-category-field.tsx', { '@/lib/event-category': categoryLib, '@/lib/design-tokens': themeLib });
let value = '일정'; const fieldProps = () => ({ value, onChange: next => { value = next; } });
const renderField = () => field('EventCategoryField', fieldProps());
const radio = (tree, choice) => nodes(tree).find(n => n.type === 'input' && n.props.type === 'radio' && n.props.value === choice);
radio(renderField(), 'custom').props.onChange(); assert.equal(value, '');
nodes(renderField()).find(n => n.props.name === 'categoryCustom').props.onChange({ target: { value: '공부' } });
assert.equal(value, '공부');
radio(renderField(), '행사').props.onChange(); assert.equal(value, '행사');
assert.ok(!nodes(renderField()).some(n => n.props.name === 'categoryCustom'));
radio(renderField(), 'custom').props.onChange(); assert.equal(value, '공부', 'Switching back restores the typed custom value.');
const colorComponent = await import(await moduleUrl('components/category-color-settings.tsx'));
const settings = { colors: { 공부: '#ffffff' }, ready: true, busy: false, error: null, refresh() {}, async save() { return true; } };
const colorMarkup = renderToStaticMarkup(createElement(colorComponent.CategoryColorSettings, { categories: ['공부'], settings, offline: false }));
assert.match(colorMarkup, /종류별 색상/); assert.match(colorMarkup, /type="color" value="#ffffff"/);
assert.match(colorMarkup, /같은 종류의 모든 일정/); assert.match(colorMarkup, /색상 저장/);
const offlineMarkup = renderToStaticMarkup(createElement(colorComponent.CategoryColorSettings, { categories: ['공부'], settings, offline: true }));
assert.match(offlineMarkup, /fieldset disabled/);
const calendarDeps = { '@/lib/event-category': categoryLib, '@/lib/design-tokens': themeLib, '@/components/category-color-settings': colorComponent,
  '@/components/bulk-event-manager': { BulkEventManager: () => null } }; // Closed in these category-filter tests; separately tested in test-bulk-events.
for (const name of ['recurrence', 'event-duration', 'occurrences', 'calendar-view']) calendarDeps[`@/lib/${name}`] = await import(await moduleUrl(`lib/${name}.ts`));
const calendar = await harness('components/calendar-workspace.tsx', calendarDeps);
const item = { ...base, recurrenceInterval: 1, recurrenceDay: null, accent: '#816890', soft: '#eee8f3', reminders: [] };
let schedules = [{ ...item, id: 1, title: 'A 계획', category: '전체' }, { ...item, id: 2, title: 'B 계획', category: '공부' }];
const renderCalendar = () => calendar('CalendarWorkspace', { schedules, selectedId: 1, selectedDate: base.eventDate, now: Date.parse('2030-09-10T09:00:00+09:00'), isSampleMode: false, colorSettings: settings, onSelect() {}, onCreate() {} });
const filter = (tree, label) => nodes(tree).find(n => n.type === 'button' && n.props['aria-label'] === label);
const titles = tree => nodes(tree).filter(n => n.props.className === 'agenda-title').map(n => n.props.children[0]);
assert.deepEqual(titles(renderCalendar()), ['A 계획', 'B 계획']);
assert.equal(nodes(filter(renderCalendar(), '공부 종류만 보기')).find(n => n.type === 'span').props.style.background, '#ffffff');
filter(renderCalendar(), '전체 종류만 보기').props.onClick(); assert.deepEqual(titles(renderCalendar()), ['A 계획']);
filter(renderCalendar(), '모든 일정 종류 보기').props.onClick(); assert.deepEqual(titles(renderCalendar()), ['A 계획', 'B 계획']);
filter(renderCalendar(), '공부 종류만 보기').props.onClick(); assert.deepEqual(titles(renderCalendar()), ['B 계획']);
schedules = schedules.slice(0, 1); assert.deepEqual(titles(renderCalendar()), ['A 계획'], 'Removing the last filtered kind returns to all kinds.');
assert.equal(filter(renderCalendar(), '모든 일정 종류 보기').props['aria-pressed'], true);
schedules.push({ ...item, id: 2, title: 'B 계획', category: '공부' });
filter(renderCalendar(), '모든 일정 종류 보기').props.onClick();
nodes(renderCalendar()).find(n => n.type === 'input' && n.props.type === 'search').props.onChange({ target: { value: '공부' } });
assert.deepEqual(titles(renderCalendar()), ['B 계획'], 'Category search also works in the list view.');
console.log('PASS: custom category validation, safe themes, escaped editable values, preset/custom switching, distinct all filter, removed-kind fallback and category search');
