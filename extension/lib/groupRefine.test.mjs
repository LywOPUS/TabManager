import assert from 'node:assert/strict';
import { applyGroupRefine, compactRefinePayload } from './groupRefine.js';

const preview = {
  groups: [
    {
      key: 'Was',
      name: 'Was',
      tabs: [
        { id: '1', title: 'How Kingdom Was Made - YouTube', url: 'https://youtube.com/watch?v=a' },
        { id: '2', title: 'How Balatro Was Made - YouTube', url: 'https://youtube.com/watch?v=b' },
        { id: '3', title: '3 Hours of Generative Ambient - YouTube', url: 'https://youtube.com/watch?v=c' },
      ],
      tabIds: ['1', '2', '3'],
    },
  ],
  ungrouped: [{ id: '9', title: 'Gmail', url: 'https://mail.google.com/' }],
};

const payload = compactRefinePayload(preview);
assert.equal(payload[0].key, 'g0');
assert.ok(payload[0].samples.length <= 5);

const next = applyGroupRefine(preview, {
  groups: [{ key: 'g0', name: '制作访谈', reject: ['3'] }],
});
assert.equal(next.groups.length, 1);
assert.equal(next.groups[0].name, '制作访谈');
assert.deepEqual(next.groups[0].tabIds, ['1', '2']);
assert.ok(next.ungrouped.some((t) => t.id === '3'));
assert.ok(next.ungrouped.some((t) => t.id === '9'));

const dissolved = applyGroupRefine(preview, {
  groups: [{ key: 'g0', name: '杂', reject: ['1', '2'] }],
});
assert.equal(dissolved.groups.length, 0);
assert.equal(dissolved.ungrouped.length, 4);

console.log('groupRefine apply ok');
