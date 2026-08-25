import assert from 'node:assert/strict';
import { getData, mergeImport, mutateData, normalizeImport } from './storage.js';

function backup(overrides = {}) {
  return {
    schemaVersion: 1,
    sessions: [
      {
        id: 'same',
        name: '会话',
        createdAt: 123,
        groups: [
          {
            id: 'same',
            name: '未分组',
            tabs: [
              { id: 'same', title: 'Example', url: 'https://example.com/' },
              { id: 'same', title: 'Example 2', url: 'https://example.com/two' },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

{
  const imported = backup();
  const normalized = normalizeImport(imported);
  const ids = [normalized[0].id, normalized[0].groups[0].id, ...normalized[0].groups[0].tabs.map((tab) => tab.id)];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id !== 'same'));
  assert.equal(imported.sessions[0].id, 'same', '不得修改解析出的原始备份对象');
}

{
  const data = { schemaVersion: 1, sessions: [{ id: 'same', name: '已有', createdAt: 1, groups: [] }] };
  mergeImport(data, backup());
  assert.equal(data.sessions.length, 2);
  assert.notEqual(data.sessions[1].id, data.sessions[0].id);
}

assert.throws(() => normalizeImport({}), /sessions 必须是数组/);
assert.throws(
  () => normalizeImport(backup({ sessions: [{ name: '坏数据', createdAt: 1, groups: [{ name: '组', tabs: [{}] }] }] })),
  /url 必须是非空文本/,
);
assert.throws(
  () => normalizeImport(backup({ sessions: [{ name: '坏数据', createdAt: 1, groups: [{ name: '组', tabs: [{ title: '内部页', url: 'chrome:\/\/settings' }] }] }] })),
  /不是可恢复的网页地址/,
);

{
  let stored = { schemaVersion: 1, sessions: [] };
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          return { tabManagerData: structuredClone(stored) };
        },
        async set(next) {
          stored = structuredClone(next.tabManagerData);
        },
      },
    },
  };

  await Promise.all([
    mutateData(async (data) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      data.sessions.push({ id: 'first', name: 'First', createdAt: 1, groups: [] });
    }),
    mutateData((data) => {
      data.sessions.push({ id: 'second', name: 'Second', createdAt: 2, groups: [] });
    }),
  ]);

  assert.deepEqual(stored.sessions.map((session) => session.id), ['first', 'second']);

  stored = {
    schemaVersion: 1,
    sessions: [
      { id: 'keep', name: '好会话', createdAt: 9, groups: [{ id: 'g', name: '未分组', tabs: [{ id: 't', title: 'A', url: 'https://a.test/' }, { id: 1 }] }] },
      { name: '无 id', createdAt: 1, groups: [] },
    ],
  };
  const parsed = await getData();
  assert.equal(parsed.sessions.length, 1);
  assert.equal(parsed.sessions[0].id, 'keep');
  assert.equal(parsed.sessions[0].groups[0].tabs.length, 1);
  assert.equal(parsed.sessions[0].groups[0].tabs[0].url, 'https://a.test/');

  if (previousChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = previousChrome;
}

console.log('storage ok');
