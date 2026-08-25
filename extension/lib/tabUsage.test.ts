import assert from 'node:assert/strict';
import { formatIdle, tabIdleMs, tabLastAccessedMs } from './tabUsage.js';

const now = Date.UTC(2026, 7, 25, 12, 0, 0);

assert.equal(tabLastAccessedMs({ lastAccessed: 0 }), null);
assert.equal(tabLastAccessedMs({ lastAccessed: undefined }), null);
assert.equal(tabLastAccessedMs({}), null);
assert.equal(tabIdleMs({ lastAccessed: 0 }, now), null);
assert.equal(tabIdleMs({ lastAccessed: now - 5 * 60 * 1000 }, now), 5 * 60 * 1000);

assert.equal(formatIdle(null), '—');
assert.equal(formatIdle(0), '刚刚');
assert.equal(formatIdle(45 * 60 * 1000), '45 分钟前');
assert.equal(formatIdle(3 * 60 * 60 * 1000), '3 小时前');

console.log('tabUsage ok');
