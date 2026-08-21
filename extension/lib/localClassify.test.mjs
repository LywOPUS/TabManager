import assert from 'node:assert/strict';
import { suggestGroupsSmart } from './localClassify.js';
import { normalizeClassifyMode } from './settings.js';

assert.equal(normalizeClassifyMode('site'), 'browser');
assert.equal(normalizeClassifyMode('unknown'), 'browser');
assert.equal(normalizeClassifyMode('ollama'), 'ollama');
assert.equal(normalizeClassifyMode('browser'), 'browser');

const empty = await suggestGroupsSmart([]);
assert.equal(empty.source, 'empty');
assert.deepEqual(empty.preview.groups, []);

const items = [
  { id: '1', title: 'a', url: 'https://github.com/a/b' },
  { id: '2', title: 'b', url: 'https://github.com/c/d' },
];
const site = await suggestGroupsSmart(items, { classifyMode: 'site' });
assert.equal(site.source, 'error');
assert.ok(site.error.includes('已停用按站点'));
assert.equal(site.preview.groups.length, 0, 'site 模式不得走出站点启发式分组');

const unknown = await suggestGroupsSmart(items, { classifyMode: 'heuristic' });
assert.equal(unknown.source, 'error');
assert.equal(unknown.preview.groups.length, 0);

console.log('localClassify no-heuristic ok');
