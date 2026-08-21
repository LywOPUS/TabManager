import assert from 'node:assert/strict';
import {
  canUseOffscreen,
  inOffscreenPage,
  inServiceWorker,
  shouldOffloadModel,
} from './offscreenRuntime.js';

assert.equal(inServiceWorker(), true, 'Node 测试环境没有 document');
assert.equal(inOffscreenPage(), false);
assert.equal(canUseOffscreen(), false, 'Node 没有 chrome.offscreen');
assert.equal(shouldOffloadModel({ bundled: true }), false);
assert.equal(shouldOffloadModel({ bundled: false }), false);

console.log('offscreenRuntime ok');
