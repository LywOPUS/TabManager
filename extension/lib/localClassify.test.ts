import assert from 'node:assert/strict';
import { suggestGroupsSmart, __test__ } from './localClassify.js';
import { normalizeClassifyMode } from './settings.js';

// 历史模式一律归一到浏览器内小模型
assert.equal(normalizeClassifyMode('site'), 'browser');
assert.equal(normalizeClassifyMode('unknown'), 'browser');
assert.equal(normalizeClassifyMode('ollama'), 'browser');
assert.equal(normalizeClassifyMode('openai'), 'browser');
assert.equal(normalizeClassifyMode('browser'), 'browser');

const empty = await suggestGroupsSmart([]);
assert.equal(empty.source, 'empty');
assert.deepEqual(empty.preview.groups, []);

// sealPreview：合并同名（留短名）、丢不足 2 条的组、剩余进未分组
{
  const items = [
    { id: '1', title: 'a', url: 'https://a.com/1' },
    { id: '2', title: 'b', url: 'https://a.com/2' },
    { id: '3', title: 'c', url: 'https://b.com/1' },
    { id: '4', title: 'd', url: 'https://b.com/2' },
    { id: '5', title: 'e', url: 'https://c.com/1' },
  ];
  const sealed = __test__.sealPreview(
    {
      groups: [
        { name: '前端开发', tabs: [items[0], items[1]] },
        { name: '前端', tabs: [items[2]] }, // 不足 2 条，丢
        { name: '前端', tabs: [items[3], items[4]] }, // 与「前端开发」不同名？同名归并
      ],
      ungrouped: [],
    },
    items,
  );
  assert.equal(sealed.groups.length, 2, '同名合并 + 不足 2 条的组被丢');
  const merged = sealed.groups.find((g) => g.name === '前端');
  assert.deepEqual(merged.tabIds.sort(), ['4', '5']);
  const big = sealed.groups.find((g) => g.name === '前端开发');
  assert.deepEqual(big.tabIds, ['1', '2']);
  // 3 号被「不足 2 条」的组释放后回到未分组
  assert.deepEqual(sealed.ungrouped.map((t) => t.id), ['3']);
}

// sealPreview：同一个 tab 不得出现在两个组
{
  const t = { id: '1', title: 'a', url: 'https://a.com/1' };
  const u = { id: '2', title: 'b', url: 'https://a.com/2' };
  const sealed = __test__.sealPreview(
    { groups: [{ name: '前端', tabs: [t, u] }, { name: '后端', tabs: [t, u] }], ungrouped: [] },
    [t, u],
  );
  assert.equal(sealed.groups.length, 1);
  assert.equal(sealed.groups[0].name, '前端');
}

console.log('localClassify browser-only ok');
