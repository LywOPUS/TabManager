import assert from 'node:assert/strict';
import { collectClosableTabs, CLOSE_IDLE_MS } from './closeSuggest.js';

const now = Date.now();
function fakeTab(overrides = {}) {
  return {
    id: 1,
    windowId: 1,
    title: 't',
    url: 'https://a.com/',
    lastAccessed: now,
    active: false,
    audible: false,
    pinned: false,
    discarded: false,
    ...overrides,
  };
}

const previousChrome = globalThis.chrome;
globalThis.chrome = {
  tabs: {
    query: async () => [
      fakeTab({ id: 1, url: 'https://stashed.com/page' }), // 已收纳
      fakeTab({ id: 2, url: 'https://dup.com/', lastAccessed: now - 1000 }), // 重复·保留新的一份
      fakeTab({ id: 3, url: 'https://dup.com/', lastAccessed: now - 5000 }), // 重复·这份较旧 → 建议
      fakeTab({ id: 4, url: 'https://old.com/', lastAccessed: now - CLOSE_IDLE_MS - 1000 }), // 闲置
      fakeTab({ id: 5, url: 'https://fresh.com/', lastAccessed: now }), // 无理由
      fakeTab({ id: 6, url: 'https://active.com/', active: true }), // 当前页 → 排除
      fakeTab({ id: 7, url: 'https://pinned.com/', pinned: true }), // 钉住 → 排除
      fakeTab({ id: 8, url: 'https://audible.com/', audible: true }), // 有声 → 排除
      fakeTab({ id: 9, url: 'chrome://extensions' }), // 不可收纳 → 排除
      fakeTab({ id: 10, url: 'https://frozen.com/', discarded: true }), // 已休眠
      fakeTab({ id: 11, url: 'https://epoch.com/', lastAccessed: 0 }), // 无效时间戳，不当闲置
    ],
  },
  storage: {
    local: {
      get: async () => ({
        tabManagerData: {
          schemaVersion: 1,
          sessions: [
            {
              id: 's1',
              name: '会话',
              createdAt: 1,
              groups: [
                { id: 'g1', name: '未分组', tabs: [{ id: 't1', title: 'x', url: 'https://www.stashed.com/page/' }] },
              ],
            },
          ],
        },
      }),
    },
  },
};

try {
  const { rows, actionableCount } = await collectClosableTabs();
  assert.equal(actionableCount, 7, '排除钉住/有声/当前页/不可收纳协议');

  const byId = new Map(rows.map((r) => [r.tabId, r]));
  assert.ok(byId.get(1).reasons.includes('已收纳'), '归一化后命中收纳会话（www/尾斜杠差异）');
  assert.ok(byId.get(3).reasons.includes('重复打开'));
  assert.ok(!byId.get(2).reasons.includes('重复打开'), '重复组里最近访问的一份保留');
  assert.ok(byId.get(4).reasons.some((r) => r.startsWith('闲置')));
  assert.ok(byId.get(10).reasons.includes('已休眠'));
  assert.equal(byId.get(5).reasons.length, 0, '刚用过的无理由');
  assert.equal(byId.get(11).idleMs, null, 'lastAccessed=0 不当成 1970');
  assert.ok(!byId.get(11).reasons.some((r) => r.startsWith('闲置')));

  // 排序：理由多的在前
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].reasons.length >= rows[i].reasons.length);
  }
} finally {
  if (previousChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = previousChrome;
}

console.log('closeSuggest ok');
